#include <windows.h>
#include <dshow.h>
#include <streams.h>
#include <ks.h>
#include <ksmedia.h>
#include <initguid.h>

#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "virtual_camera_shared.h"

using namespace cam_player_vcam;

// Permanent device identity. Renaming changes only the friendly name.
// {6E4A7C7A-6400-4A91-A857-E17A46D99431}
DEFINE_GUID(CLSID_CamPlayerVirtualCamera,
0x6e4a7c7a, 0x6400, 0x4a91, 0xa8, 0x57, 0xe1, 0x7a, 0x46, 0xd9, 0x94, 0x31);

namespace {

constexpr REFERENCE_TIME kDefaultFrameDuration = 10'000'000 / 30;

struct Format { LONG width; LONG height; LONG fps; };

std::wstring CameraName() {
  wchar_t value[128] = {};
  DWORD bytes = sizeof(value);
  if (RegGetValueW(HKEY_LOCAL_MACHINE, kRegistryPath, L"Name",
                   RRF_RT_REG_SZ, nullptr, value, &bytes) == ERROR_SUCCESS
      && value[0]) {
    return value;
  }
  return kDefaultCameraName;
}

class SharedFrameReader {
 public:
  SharedFrameReader() { OpenControl(); }
  ~SharedFrameReader() {
    if (control_) InterlockedDecrement(&control_->consumers);
    if (frame_) UnmapViewOfFile(frame_);
    if (frame_mapping_) CloseHandle(frame_mapping_);
    if (control_) UnmapViewOfFile(control_);
    if (control_mapping_) CloseHandle(control_mapping_);
  }

  Format SourceFormat() {
    OpenControl();
    if (!control_ || control_->version != kProtocolVersion) return {1280, 720, 30};
    const LONG reported_width = control_->source_width;
    const LONG reported_height = control_->source_height;
    const LONG reported_fps = control_->fps_milli / 1000;
    const LONG width = std::clamp(reported_width, 2L, static_cast<LONG>(kMaxDimension));
    const LONG height = std::clamp(reported_height, 2L, static_cast<LONG>(kMaxDimension));
    const LONG fps = std::clamp(reported_fps, 1L, 60L);
    return {width & ~1L, height & ~1L, fps};
  }

  void SetNegotiated(LONG width, LONG height) {
    OpenControl();
    if (!control_) return;
    InterlockedExchange(&control_->negotiated_width, width);
    InterlockedExchange(&control_->negotiated_height, height);
  }

  bool CopyRgb32(BYTE* destination, LONG output_width, LONG output_height,
                 LONG output_stride) {
    if (!OpenCurrentFrame()) return false;
    for (int attempt = 0; attempt < 2; ++attempt) {
      const LONG before = frame_->sequence;
      MemoryBarrier();
      const LONG index = frame_->active_buffer & 1;
      const LONG source_width = frame_->width;
      const LONG source_height = frame_->height;
      const LONG source_stride = frame_->stride;
      const LONG bytes = frame_->bytes;
      if (source_width < 2 || source_height < 2 || source_stride < source_width * 4
          || bytes < source_stride * source_height
          || static_cast<std::uint32_t>(bytes) > frame_->capacity) return false;
      const auto* source = reinterpret_cast<const BYTE*>(frame_ + 1)
          + static_cast<std::size_t>(index) * frame_->capacity;
      for (LONG y = 0; y < output_height; ++y) {
        const LONG sy = std::min(source_height - 1,
            static_cast<LONG>((static_cast<long long>(y) * source_height) / output_height));
        BYTE* row = destination + static_cast<std::size_t>(output_height - 1 - y) * output_stride;
        const BYTE* source_row = source + static_cast<std::size_t>(sy) * source_stride;
        for (LONG x = 0; x < output_width; ++x) {
          const LONG sx = std::min(source_width - 1,
              static_cast<LONG>((static_cast<long long>(x) * source_width) / output_width));
          const BYTE* rgba = source_row + static_cast<std::size_t>(sx) * 4;
          BYTE* bgra = row + static_cast<std::size_t>(x) * 4;
          bgra[0] = rgba[2];
          bgra[1] = rgba[1];
          bgra[2] = rgba[0];
          bgra[3] = 0xff;
        }
      }
      MemoryBarrier();
      if (before == frame_->sequence) return true;
    }
    return false;
  }

 private:
  void OpenControl() {
    if (control_) return;
    control_mapping_ = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, kControlMappingName);
    if (!control_mapping_) return;
    control_ = static_cast<ControlBlock*>(MapViewOfFile(
        control_mapping_, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(ControlBlock)));
    if (!control_) {
      CloseHandle(control_mapping_);
      control_mapping_ = nullptr;
      return;
    }
    InterlockedIncrement(&control_->consumers);
  }

  bool OpenCurrentFrame() {
    OpenControl();
    if (!control_ || control_->version != kProtocolVersion) return false;
    const LONG generation = control_->generation;
    if (frame_ && generation == frame_generation_) return true;
    if (frame_) UnmapViewOfFile(frame_);
    if (frame_mapping_) CloseHandle(frame_mapping_);
    frame_ = nullptr;
    frame_mapping_ = nullptr;
    frame_generation_ = 0;
    wchar_t mapping_name[96] = {};
    wcsncpy_s(mapping_name, control_->frame_mapping_name, _TRUNCATE);
    if (!mapping_name[0]) return false;
    frame_mapping_ = OpenFileMappingW(FILE_MAP_READ, FALSE, mapping_name);
    if (!frame_mapping_) return false;
    frame_ = static_cast<FrameBlock*>(MapViewOfFile(frame_mapping_, FILE_MAP_READ, 0, 0, 0));
    if (!frame_) {
      CloseHandle(frame_mapping_);
      frame_mapping_ = nullptr;
      return false;
    }
    frame_generation_ = generation;
    return frame_->version == kProtocolVersion;
  }

  HANDLE control_mapping_ = nullptr;
  ControlBlock* control_ = nullptr;
  HANDLE frame_mapping_ = nullptr;
  FrameBlock* frame_ = nullptr;
  LONG frame_generation_ = 0;
};

class VirtualCameraPin final : public CSourceStream,
                               public IAMStreamConfig,
                               public IKsPropertySet {
 public:
  VirtualCameraPin(HRESULT* result, CSource* filter)
      : CSourceStream(NAME("Cam Player Camera Output"), result, filter, L"Capture") {}

  DECLARE_IUNKNOWN;

  STDMETHODIMP NonDelegatingQueryInterface(REFIID iid, void** object) override {
    if (iid == IID_IAMStreamConfig) return GetInterface(static_cast<IAMStreamConfig*>(this), object);
    if (iid == IID_IKsPropertySet) return GetInterface(static_cast<IKsPropertySet*>(this), object);
    return CSourceStream::NonDelegatingQueryInterface(iid, object);
  }

  HRESULT GetMediaType(int position, CMediaType* media_type) override {
    if (!media_type) return E_POINTER;
    if (position < 0) return E_INVALIDARG;
    const auto formats = Formats();
    if (position >= static_cast<int>(formats.size())) return VFW_S_NO_MORE_ITEMS;
    return BuildMediaType(formats[position], media_type);
  }

  HRESULT CheckMediaType(const CMediaType* media_type) override {
    if (!media_type || *media_type->Type() != MEDIATYPE_Video
        || *media_type->Subtype() != MEDIASUBTYPE_RGB32
        || *media_type->FormatType() != FORMAT_VideoInfo
        || media_type->FormatLength() < sizeof(VIDEOINFOHEADER)) return E_INVALIDARG;
    const auto* info = reinterpret_cast<const VIDEOINFOHEADER*>(media_type->Format());
    const LONG width = info->bmiHeader.biWidth;
    const LONG height = std::abs(info->bmiHeader.biHeight);
    return width >= 2 && height >= 2 && width <= static_cast<LONG>(kMaxDimension)
        && height <= static_cast<LONG>(kMaxDimension) ? S_OK : E_INVALIDARG;
  }

  HRESULT DecideBufferSize(IMemAllocator* allocator, ALLOCATOR_PROPERTIES* properties) override {
    if (!allocator || !properties) return E_POINTER;
    auto* info = reinterpret_cast<VIDEOINFOHEADER*>(m_mt.Format());
    if (!info) return E_UNEXPECTED;
    properties->cBuffers = 2;
    properties->cbBuffer = info->bmiHeader.biSizeImage;
    ALLOCATOR_PROPERTIES actual = {};
    const HRESULT result = allocator->SetProperties(properties, &actual);
    return SUCCEEDED(result) && actual.cbBuffer >= properties->cbBuffer ? S_OK : E_FAIL;
  }

  HRESULT SetMediaType(const CMediaType* media_type) override {
    const HRESULT result = CSourceStream::SetMediaType(media_type);
    if (SUCCEEDED(result)) {
      const auto* info = reinterpret_cast<const VIDEOINFOHEADER*>(media_type->Format());
      width_ = info->bmiHeader.biWidth;
      height_ = std::abs(info->bmiHeader.biHeight);
      frame_duration_ = info->AvgTimePerFrame > 0 ? info->AvgTimePerFrame : kDefaultFrameDuration;
      if (configured_format_.width <= 0 || configured_format_.height <= 0) {
        configured_format_ = {width_, height_, FrameRate(frame_duration_)};
      }
      reader_.SetNegotiated(width_, height_);
    }
    return result;
  }

  HRESULT OnThreadCreate() override {
    next_frame_start_ = -1;
    return S_OK;
  }

  HRESULT FillBuffer(IMediaSample* sample) override {
    if (!sample) return E_POINTER;
    CRefTime current_stream_time;
    if (SUCCEEDED(m_pFilter->StreamTime(current_stream_time))) {
      const REFERENCE_TIME stream_time = current_stream_time;
      if (next_frame_start_ < 0 || stream_time - next_frame_start_ > frame_duration_ * 2) {
        next_frame_start_ = stream_time;
      } else if (next_frame_start_ > stream_time) {
        const auto delay_ms = static_cast<DWORD>(
            std::max<REFERENCE_TIME>(1, (next_frame_start_ - stream_time + 9'999) / 10'000));
        Sleep(delay_ms);
      }
    } else if (next_frame_start_ < 0) {
      next_frame_start_ = 0;
    }
    BYTE* data = nullptr;
    if (FAILED(sample->GetPointer(&data)) || !data) return E_FAIL;
    const LONG stride = width_ * 4;
    const LONG bytes = stride * height_;
    if (sample->GetSize() < bytes) return E_FAIL;
    if (!reader_.CopyRgb32(data, width_, height_, stride)) {
      std::memset(data, 0, bytes);
    }
    sample->SetActualDataLength(bytes);
    REFERENCE_TIME start = next_frame_start_;
    REFERENCE_TIME stop = start + frame_duration_;
    sample->SetTime(&start, &stop);
    sample->SetSyncPoint(TRUE);
    next_frame_start_ = stop;
    return S_OK;
  }

  STDMETHODIMP SetFormat(AM_MEDIA_TYPE* media_type) override {
    if (!media_type) return E_POINTER;
    const HRESULT checked = CheckMediaType(reinterpret_cast<CMediaType*>(media_type));
    if (FAILED(checked)) return checked;
    m_mt = *reinterpret_cast<CMediaType*>(media_type);
    const auto* info = reinterpret_cast<const VIDEOINFOHEADER*>(m_mt.Format());
    width_ = info->bmiHeader.biWidth;
    height_ = std::abs(info->bmiHeader.biHeight);
    frame_duration_ = info->AvgTimePerFrame > 0 ? info->AvgTimePerFrame : kDefaultFrameDuration;
    configured_format_ = {width_, height_, FrameRate(frame_duration_)};
    reader_.SetNegotiated(width_, height_);
    IPin* connected = nullptr;
    if (SUCCEEDED(ConnectedTo(&connected)) && connected) {
      connected->Release();
      return m_pFilter->GetFilterGraph()->Reconnect(this);
    }
    return S_OK;
  }

  STDMETHODIMP GetFormat(AM_MEDIA_TYPE** media_type) override {
    if (!media_type) return E_POINTER;
    CMediaType current = m_mt;
    if (!current.IsValid()) BuildMediaType(Formats().front(), &current);
    *media_type = CreateMediaType(&current);
    return *media_type ? S_OK : E_OUTOFMEMORY;
  }

  STDMETHODIMP GetNumberOfCapabilities(int* count, int* size) override {
    if (!count || !size) return E_POINTER;
    *count = static_cast<int>(Formats().size());
    *size = sizeof(VIDEO_STREAM_CONFIG_CAPS);
    return S_OK;
  }

  STDMETHODIMP GetStreamCaps(int index, AM_MEDIA_TYPE** media_type, BYTE* capabilities) override {
    if (!media_type || !capabilities) return E_POINTER;
    const auto formats = Formats();
    if (index < 0 || index >= static_cast<int>(formats.size())) return S_FALSE;
    CMediaType type;
    HRESULT result = BuildMediaType(formats[index], &type);
    if (FAILED(result)) return result;
    *media_type = CreateMediaType(&type);
    if (!*media_type) return E_OUTOFMEMORY;
    auto* caps = reinterpret_cast<VIDEO_STREAM_CONFIG_CAPS*>(capabilities);
    ZeroMemory(caps, sizeof(*caps));
    caps->guid = FORMAT_VideoInfo;
    caps->InputSize = {formats[index].width, formats[index].height};
    caps->MinCroppingSize = {2, 2};
    caps->MaxCroppingSize = {static_cast<LONG>(kMaxDimension), static_cast<LONG>(kMaxDimension)};
    caps->CropGranularityX = caps->CropGranularityY = 2;
    caps->MinOutputSize = {2, 2};
    caps->MaxOutputSize = {static_cast<LONG>(kMaxDimension), static_cast<LONG>(kMaxDimension)};
    caps->OutputGranularityX = caps->OutputGranularityY = 2;
    caps->MinFrameInterval = 10'000'000 / 60;
    caps->MaxFrameInterval = 10'000'000;
    caps->MinBitsPerSecond = 2 * 2 * 32;
    caps->MaxBitsPerSecond = LONG_MAX;
    return S_OK;
  }

  STDMETHODIMP Set(REFGUID, DWORD, LPVOID, DWORD, LPVOID, DWORD) override {
    return E_NOTIMPL;
  }
  STDMETHODIMP Get(REFGUID set, DWORD id, LPVOID, DWORD, LPVOID data,
                   DWORD data_size, DWORD* returned) override {
    if (set != AMPROPSETID_Pin || id != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
    if (!data || data_size < sizeof(GUID)) return E_UNEXPECTED;
    *reinterpret_cast<GUID*>(data) = PIN_CATEGORY_CAPTURE;
    if (returned) *returned = sizeof(GUID);
    return S_OK;
  }
  STDMETHODIMP QuerySupported(REFGUID set, DWORD id, DWORD* support) override {
    if (!support) return E_POINTER;
    if (set == AMPROPSETID_Pin && id == AMPROPERTY_PIN_CATEGORY) {
      *support = KSPROPERTY_SUPPORT_GET;
      return S_OK;
    }
    *support = 0;
    return S_FALSE;
  }

 private:
  std::vector<Format> Formats() {
    const Format source = reader_.SourceFormat();
    std::vector<Format> formats;
    if (configured_format_.width > 0 && configured_format_.height > 0) {
      formats.push_back(configured_format_);
    }
    formats.insert(formats.end(), {source,
      {640, 480, 30}, {1280, 720, 30}, {1920, 1080, 30},
      {1080, 1920, 30}, {1920, 1920, 30}});
    std::vector<Format> unique;
    for (auto format : formats) {
      format.width &= ~1L;
      format.height &= ~1L;
      if (std::none_of(unique.begin(), unique.end(), [&](const Format& item) {
        return item.width == format.width && item.height == format.height;
      })) unique.push_back(format);
    }
    return unique;
  }

  static LONG FrameRate(REFERENCE_TIME duration) {
    if (duration <= 0) return 30;
    return std::clamp(static_cast<LONG>((10'000'000 + duration / 2) / duration), 1L, 60L);
  }

  static HRESULT BuildMediaType(const Format& format, CMediaType* media_type) {
    auto* info = reinterpret_cast<VIDEOINFOHEADER*>(
        media_type->AllocFormatBuffer(sizeof(VIDEOINFOHEADER)));
    if (!info) return E_OUTOFMEMORY;
    ZeroMemory(info, sizeof(*info));
    info->AvgTimePerFrame = 10'000'000 / std::clamp(format.fps, 1L, 60L);
    info->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info->bmiHeader.biWidth = format.width;
    info->bmiHeader.biHeight = format.height;
    info->bmiHeader.biPlanes = 1;
    info->bmiHeader.biBitCount = 32;
    info->bmiHeader.biCompression = BI_RGB;
    info->bmiHeader.biSizeImage = format.width * format.height * 4;
    info->dwBitRate = format.width * format.height * 32 * format.fps;
    media_type->SetType(&MEDIATYPE_Video);
    media_type->SetSubtype(&MEDIASUBTYPE_RGB32);
    media_type->SetFormatType(&FORMAT_VideoInfo);
    media_type->SetTemporalCompression(FALSE);
    media_type->SetSampleSize(info->bmiHeader.biSizeImage);
    return S_OK;
  }

  SharedFrameReader reader_;
  LONG width_ = 1280;
  LONG height_ = 720;
  REFERENCE_TIME frame_duration_ = kDefaultFrameDuration;
  REFERENCE_TIME next_frame_start_ = -1;
  Format configured_format_ = {0, 0, 0};
};

class VirtualCameraFilter final : public CSource {
 public:
  static CUnknown* WINAPI CreateInstance(IUnknown* outer, HRESULT* result) {
    auto* filter = new VirtualCameraFilter(outer, result);
    if (!filter && result) *result = E_OUTOFMEMORY;
    return filter;
  }

 private:
  VirtualCameraFilter(IUnknown* outer, HRESULT* result)
      : CSource(NAME("Cam Player Virtual Camera"), outer, CLSID_CamPlayerVirtualCamera) {
    auto* pin = new VirtualCameraPin(result, this);
    if (!pin && result) *result = E_OUTOFMEMORY;
  }
};

WCHAR g_filter_name[] = L"Cam Player Camera";
const AMOVIESETUP_MEDIATYPE kPinMediaTypes = {&MEDIATYPE_Video, &MEDIASUBTYPE_RGB32};
const AMOVIESETUP_PIN kOutputPin = {
  L"Capture", FALSE, TRUE, FALSE, FALSE, &CLSID_NULL, nullptr, 1, &kPinMediaTypes
};
const AMOVIESETUP_FILTER kFilterSetup = {
  &CLSID_CamPlayerVirtualCamera, g_filter_name, MERIT_DO_NOT_USE, 1, &kOutputPin
};

HRESULT RegisterCaptureCategory(bool install) {
  IFilterMapper2* mapper = nullptr;
  HRESULT result = CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_IFilterMapper2, reinterpret_cast<void**>(&mapper));
  if (FAILED(result)) return result;
  if (install) {
    REGPINTYPES media_type = {&MEDIATYPE_Video, &MEDIASUBTYPE_RGB32};
    REGFILTERPINS2 pin = {};
    pin.dwFlags = REG_PINFLAG_B_OUTPUT;
    pin.cInstances = 1;
    pin.nMediaTypes = 1;
    pin.lpMediaType = &media_type;
    REGFILTER2 filter = {};
    filter.dwVersion = 2;
    filter.dwMerit = MERIT_DO_NOT_USE;
    filter.cPins2 = 1;
    filter.rgPins2 = &pin;
    IMoniker* moniker = nullptr;
    const auto name = CameraName();
    result = mapper->RegisterFilter(CLSID_CamPlayerVirtualCamera, name.c_str(), &moniker,
                                    &CLSID_VideoInputDeviceCategory, nullptr, &filter);
    if (moniker) moniker->Release();
  } else {
    result = mapper->UnregisterFilter(&CLSID_VideoInputDeviceCategory, nullptr,
                                      CLSID_CamPlayerVirtualCamera);
  }
  mapper->Release();
  return result;
}

} // namespace

CFactoryTemplate g_Templates[] = {{
  g_filter_name, &CLSID_CamPlayerVirtualCamera,
  VirtualCameraFilter::CreateInstance, nullptr, &kFilterSetup
}};
int g_cTemplates = ARRAYSIZE(g_Templates);

STDAPI DllRegisterServer() {
  HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  HRESULT result = AMovieDllRegisterServer2(TRUE);
  if (SUCCEEDED(result)) result = RegisterCaptureCategory(true);
  if (SUCCEEDED(initialized)) CoUninitialize();
  return result;
}

STDAPI DllUnregisterServer() {
  HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  RegisterCaptureCategory(false);
  HRESULT result = AMovieDllRegisterServer2(FALSE);
  if (SUCCEEDED(initialized)) CoUninitialize();
  return result;
}

extern "C" BOOL WINAPI DllEntryPoint(HINSTANCE, ULONG, LPVOID);
BOOL APIENTRY DllMain(HANDLE module, DWORD reason, LPVOID reserved) {
  return DllEntryPoint(static_cast<HINSTANCE>(module), reason, reserved);
}
