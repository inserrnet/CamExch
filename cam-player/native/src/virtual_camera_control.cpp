#include <windows.h>
#include <shellapi.h>
#include <devguid.h>
#include <newdev.h>
#include <setupapi.h>
#include <wincrypt.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

#include "virtual_camera_shared.h"

using namespace cam_player_vcam;
namespace fs = std::filesystem;

namespace {

using RegistrationFunction = HRESULT(WINAPI*)();

inline constexpr wchar_t kPnpHardwareId[] = L"SW\\{40FA78A5-9F4D-4D81-80BB-E8ED5939A0E1}\0";
inline constexpr wchar_t kPnpControlPath[] = L"\\\\.\\CamPlayerPnpCamera";

std::string Utf8(const std::wstring& value) {
  if (value.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                                 nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                      result.data(), size, nullptr, nullptr);
  return result;
}

std::string JsonEscape(const std::wstring& value) {
  std::string utf8 = Utf8(value);
  std::string result;
  for (char ch : utf8) {
    if (ch == '\\' || ch == '"') result.push_back('\\');
    if (ch == '\n') result += "\\n";
    else if (ch == '\r') result += "\\r";
    else result.push_back(ch);
  }
  return result;
}

void Print(const std::string& value) {
  DWORD written = 0;
  WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), value.data(), static_cast<DWORD>(value.size()),
            &written, nullptr);
}

bool IsAdministrator() {
  BOOL member = FALSE;
  SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
  PSID group = nullptr;
  if (AllocateAndInitializeSid(&authority, 2, SECURITY_BUILTIN_DOMAIN_RID,
      DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &group)) {
    CheckTokenMembership(nullptr, group, &member);
    FreeSid(group);
  }
  return member == TRUE;
}

std::wstring Quote(const std::wstring& value) {
  std::wstring result = L"\"";
  for (wchar_t ch : value) {
    if (ch == L'"') result += L'\\';
    result += ch;
  }
  return result + L"\"";
}

int Elevate(const std::vector<std::wstring>& arguments) {
  wchar_t executable[MAX_PATH] = {};
  GetModuleFileNameW(nullptr, executable, ARRAYSIZE(executable));
  std::wstring parameters = L"--elevated";
  for (const auto& argument : arguments) parameters += L" " + Quote(argument);
  SHELLEXECUTEINFOW info = {sizeof(info)};
  info.fMask = SEE_MASK_NOCLOSEPROCESS;
  info.lpVerb = L"runas";
  info.lpFile = executable;
  info.lpParameters = parameters.c_str();
  info.nShow = SW_HIDE;
  if (!ShellExecuteExW(&info)) return GetLastError() == ERROR_CANCELLED ? 1223 : 1;
  WaitForSingleObject(info.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(info.hProcess, &code);
  CloseHandle(info.hProcess);
  return static_cast<int>(code);
}

fs::path InstallDirectory() {
  wchar_t program_files[MAX_PATH] = {};
  ExpandEnvironmentStringsW(L"%ProgramFiles%", program_files, ARRAYSIZE(program_files));
  return fs::path(program_files) / L"Cam Player Virtual Camera";
}

fs::path InstalledDll() { return InstallDirectory() / L"CamPlayerVirtualCamera.dll"; }

fs::path PnpInstallDirectory() {
  wchar_t program_files[MAX_PATH] = {};
  ExpandEnvironmentStringsW(L"%ProgramFiles%", program_files, ARRAYSIZE(program_files));
  return fs::path(program_files) / L"Cam Player PnP Camera";
}

fs::path InstalledPnpInf() { return PnpInstallDirectory() / L"CamPlayerPnpCamera.inf"; }

bool DeviceHasHardwareId(HDEVINFO devices, SP_DEVINFO_DATA* device) {
  wchar_t ids[512] = {};
  DWORD type = 0;
  if (!SetupDiGetDeviceRegistryPropertyW(devices, device, SPDRP_HARDWAREID, &type,
      reinterpret_cast<PBYTE>(ids), sizeof(ids), nullptr)) return false;
  for (const wchar_t* id = ids; *id; id += wcslen(id) + 1) {
    if (_wcsicmp(id, kPnpHardwareId) == 0) return true;
  }
  return false;
}

bool FindPnpDevice(HDEVINFO* result_set = nullptr, SP_DEVINFO_DATA* result_device = nullptr) {
  HDEVINFO devices = SetupDiGetClassDevsW(&GUID_DEVCLASS_CAMERA, nullptr, nullptr, DIGCF_PRESENT);
  if (devices == INVALID_HANDLE_VALUE) return false;
  SP_DEVINFO_DATA device = {sizeof(device)};
  bool found = false;
  for (DWORD index = 0; SetupDiEnumDeviceInfo(devices, index, &device); ++index) {
    if (DeviceHasHardwareId(devices, &device)) { found = true; break; }
  }
  if (!found) {
    SetupDiDestroyDeviceInfoList(devices);
    return false;
  }
  if (result_set) *result_set = devices;
  if (result_device) *result_device = device;
  if (!result_set) SetupDiDestroyDeviceInfoList(devices);
  return true;
}

bool SetPnpFriendlyName(const std::wstring& name) {
  HDEVINFO devices = INVALID_HANDLE_VALUE;
  SP_DEVINFO_DATA device = {sizeof(device)};
  if (!FindPnpDevice(&devices, &device)) return false;
  const auto value = name.empty() ? std::wstring(kDefaultCameraName) : name.substr(0, 120);
  const BOOL okay = SetupDiSetDeviceRegistryPropertyW(devices, &device, SPDRP_FRIENDLYNAME,
      reinterpret_cast<const BYTE*>(value.c_str()),
      static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
  SetupDiDestroyDeviceInfoList(devices);
  return okay == TRUE;
}

bool CopyPnpPackage(const fs::path& source_inf) {
  std::error_code error;
  fs::create_directories(PnpInstallDirectory(), error);
  if (error) return false;
  const fs::path source_directory = source_inf.parent_path();
  for (const wchar_t* file : {L"CamPlayerPnpCamera.inf", L"CamPlayerPnpCamera.sys",
                              L"CamPlayerPnpCamera.cat"}) {
    fs::copy_file(source_directory / file, PnpInstallDirectory() / file,
                  fs::copy_options::overwrite_existing, error);
    if (error) return false;
  }
  const fs::path certificate = source_directory / L"CamPlayerPnpCamera.cer";
  if (fs::exists(certificate)) {
    fs::copy_file(certificate, PnpInstallDirectory() / certificate.filename(),
                  fs::copy_options::overwrite_existing, error);
    if (error) return false;
  }
  return true;
}

bool TrustPnpTestCertificate() {
  const fs::path path = PnpInstallDirectory() / L"CamPlayerPnpCamera.cer";
  if (!fs::exists(path)) return true;
  PCCERT_CONTEXT certificate = nullptr;
  DWORD encoding = 0;
  DWORD content = 0;
  DWORD format = 0;
  if (!CryptQueryObject(CERT_QUERY_OBJECT_FILE, path.c_str(), CERT_QUERY_CONTENT_FLAG_CERT,
      CERT_QUERY_FORMAT_FLAG_ALL, 0, &encoding, &content, &format, nullptr, nullptr,
      reinterpret_cast<const void**>(&certificate))) return false;
  bool okay = true;
  for (const wchar_t* store_name : {L"ROOT", L"TrustedPublisher"}) {
    HCERTSTORE store = CertOpenStore(CERT_STORE_PROV_SYSTEM_W, 0, 0,
        CERT_SYSTEM_STORE_LOCAL_MACHINE, store_name);
    if (!store || !CertAddCertificateContextToStore(
        store, certificate, CERT_STORE_ADD_REPLACE_EXISTING, nullptr)) okay = false;
    if (store) CertCloseStore(store, 0);
  }
  CertFreeCertificateContext(certificate);
  return okay;
}

bool InstallPnpDevice(const fs::path& source_inf, const std::wstring& name, bool* reboot) {
  if (!CopyPnpPackage(source_inf)) return false;
  if (!TrustPnpTestCertificate()) return false;
  BOOL needs_reboot = FALSE;
  if (!DiInstallDriverW(nullptr, InstalledPnpInf().c_str(), DIIRFLAG_FORCE_INF, &needs_reboot)) {
    return false;
  }
  if (!FindPnpDevice()) {
    HDEVINFO devices = SetupDiCreateDeviceInfoList(&GUID_DEVCLASS_CAMERA, nullptr);
    if (devices == INVALID_HANDLE_VALUE) return false;
    SP_DEVINFO_DATA device = {sizeof(device)};
    bool okay = SetupDiCreateDeviceInfoW(devices, L"CamPlayerPnpCamera", &GUID_DEVCLASS_CAMERA,
        L"Cam Player PnP Camera", nullptr, DICD_GENERATE_ID, &device) == TRUE;
    const DWORD hardware_bytes = static_cast<DWORD>((wcslen(kPnpHardwareId) + 2) * sizeof(wchar_t));
    if (okay) okay = SetupDiSetDeviceRegistryPropertyW(devices, &device, SPDRP_HARDWAREID,
        reinterpret_cast<const BYTE*>(kPnpHardwareId), hardware_bytes) == TRUE;
    if (okay) okay = SetupDiCallClassInstaller(DIF_REGISTERDEVICE, devices, &device) == TRUE;
    SetupDiDestroyDeviceInfoList(devices);
    if (!okay) return false;
    if (!UpdateDriverForPlugAndPlayDevicesW(nullptr, kPnpHardwareId,
        InstalledPnpInf().c_str(), INSTALLFLAG_FORCE, &needs_reboot)) return false;
  }
  if (!SetPnpFriendlyName(name)) return false;
  if (reboot) *reboot = needs_reboot == TRUE;
  return true;
}

bool RemovePnpDevice(bool* reboot) {
  HDEVINFO devices = INVALID_HANDLE_VALUE;
  SP_DEVINFO_DATA device = {sizeof(device)};
  BOOL needs_reboot = FALSE;
  if (FindPnpDevice(&devices, &device)) {
    SP_REMOVEDEVICE_PARAMS parameters = {};
    parameters.ClassInstallHeader.cbSize = sizeof(SP_CLASSINSTALL_HEADER);
    parameters.ClassInstallHeader.InstallFunction = DIF_REMOVE;
    parameters.Scope = DI_REMOVEDEVICE_GLOBAL;
    if (!SetupDiSetClassInstallParamsW(devices, &device, &parameters.ClassInstallHeader,
        sizeof(parameters)) || !SetupDiCallClassInstaller(DIF_REMOVE, devices, &device)) {
      SetupDiDestroyDeviceInfoList(devices);
      return false;
    }
    SetupDiDestroyDeviceInfoList(devices);
  }
  if (fs::exists(InstalledPnpInf())) {
    DiUninstallDriverW(nullptr, InstalledPnpInf().c_str(), 0, &needs_reboot);
  }
  std::error_code error;
  fs::remove_all(PnpInstallDirectory(), error);
  if (reboot) *reboot = needs_reboot == TRUE;
  return true;
}

std::wstring ReadName() {
  wchar_t value[128] = {};
  DWORD bytes = sizeof(value);
  if (RegGetValueW(HKEY_LOCAL_MACHINE, kRegistryPath, L"Name", RRF_RT_REG_SZ,
                   nullptr, value, &bytes) == ERROR_SUCCESS && value[0]) return value;
  return kDefaultCameraName;
}

bool WriteName(const std::wstring& name) {
  HKEY key = nullptr;
  if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, kRegistryPath, 0, nullptr, 0,
                      KEY_SET_VALUE | KEY_WOW64_64KEY, nullptr, &key, nullptr) != ERROR_SUCCESS) return false;
  const DWORD bytes = static_cast<DWORD>((name.size() + 1) * sizeof(wchar_t));
  const bool okay = RegSetValueExW(key, L"Name", 0, REG_SZ,
      reinterpret_cast<const BYTE*>(name.c_str()), bytes) == ERROR_SUCCESS;
  RegCloseKey(key);
  return okay;
}

HRESULT RegisterDll(const fs::path& dll, bool install) {
  HMODULE module = LoadLibraryW(dll.c_str());
  if (!module) return HRESULT_FROM_WIN32(GetLastError());
  auto function = reinterpret_cast<RegistrationFunction>(
      GetProcAddress(module, install ? "DllRegisterServer" : "DllUnregisterServer"));
  HRESULT result = function ? function() : E_NOINTERFACE;
  FreeLibrary(module);
  return result;
}

int Mutate(const std::vector<std::wstring>& arguments) {
  if (arguments.empty()) return 2;
  const auto& command = arguments[0];
  if (command == L"install") {
    if (arguments.size() < 3) return 2;
    const fs::path source = arguments[1];
    const std::wstring name = arguments[2].substr(0, 120);
    std::error_code error;
    fs::create_directories(InstallDirectory(), error);
    fs::copy_file(source, InstalledDll(), fs::copy_options::overwrite_existing, error);
    if (error || !WriteName(name.empty() ? kDefaultCameraName : name)) return 3;
    return SUCCEEDED(RegisterDll(InstalledDll(), true)) ? 0 : 4;
  }
  if (command == L"rename") {
    if (arguments.size() < 2 || !fs::exists(InstalledDll())) return 2;
    RegisterDll(InstalledDll(), false);
    if (!WriteName(arguments[1].substr(0, 120))) return 3;
    return SUCCEEDED(RegisterDll(InstalledDll(), true)) ? 0 : 4;
  }
  if (command == L"uninstall") {
    if (fs::exists(InstalledDll())) RegisterDll(InstalledDll(), false);
    std::error_code error;
    fs::remove(InstalledDll(), error);
    fs::remove(InstallDirectory(), error);
    RegDeleteTreeW(HKEY_LOCAL_MACHINE, kRegistryPath);
    return 0;
  }
  if (command == L"install-pnp") {
    if (arguments.size() < 3) return 2;
    bool reboot = false;
    if (!InstallPnpDevice(arguments[1], arguments[2], &reboot)) return 5;
    Print(std::string("{\"rebootRequired\":") + (reboot ? "true" : "false") + "}\n");
    return 0;
  }
  if (command == L"rename-pnp") {
    if (arguments.size() < 2 || !SetPnpFriendlyName(arguments[1])) return 5;
    return 0;
  }
  if (command == L"uninstall-pnp") {
    bool reboot = false;
    if (!RemovePnpDevice(&reboot)) return 5;
    Print(std::string("{\"rebootRequired\":") + (reboot ? "true" : "false") + "}\n");
    return 0;
  }
  return 2;
}

bool ReadExact(HANDLE input, void* destination, DWORD bytes) {
  auto* cursor = static_cast<BYTE*>(destination);
  while (bytes > 0) {
    DWORD count = 0;
    if (!ReadFile(input, cursor, bytes, &count, nullptr) || count == 0) return false;
    cursor += count;
    bytes -= count;
  }
  return true;
}

long ParseOrientation(const std::wstring& value) {
  if (value == L"landscape") return kOrientationLandscape;
  if (value == L"follow") return kOrientationFollowOutput;
  return kOrientationPortrait;
}

const char* OrientationName(long orientation) {
  if (orientation == kOrientationLandscape) return "landscape";
  if (orientation == kOrientationFollowOutput) return "follow";
  return "portrait";
}

int Serve(long orientation) {
  HANDLE control_mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
      0, sizeof(ControlBlock), kControlMappingName);
  if (!control_mapping) return 5;
  auto* control = static_cast<ControlBlock*>(MapViewOfFile(
      control_mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(ControlBlock)));
  if (!control) { CloseHandle(control_mapping); return 5; }
  ZeroMemory(control, sizeof(*control));
  control->version = kProtocolVersion;
  control->producer_pid = static_cast<LONG>(GetCurrentProcessId());
  control->orientation = orientation;

  HANDLE frame_mapping = nullptr;
  FrameBlock* frame = nullptr;
  std::uint32_t capacity = 0;
  LONG generation = 0;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  std::vector<BYTE> pixels;
  std::vector<BYTE> pnp_packet;
  HANDLE pnp = INVALID_HANDLE_VALUE;
  while (true) {
    PacketHeader packet = {};
    if (!ReadExact(input, &packet, sizeof(packet))) break;
    if (packet.magic != kPacketMagic || packet.width < 2 || packet.height < 2
        || packet.width > kMaxDimension || packet.height > kMaxDimension
        || packet.stride < packet.width * 4 || packet.bytes != packet.stride * packet.height) break;
    pixels.resize(packet.bytes);
    if (!ReadExact(input, pixels.data(), packet.bytes)) break;
    if (pnp == INVALID_HANDLE_VALUE) {
      pnp = CreateFileW(kPnpControlPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
          nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    }
    if (pnp != INVALID_HANDLE_VALUE) {
      pnp_packet.resize(sizeof(packet) + pixels.size());
      std::memcpy(pnp_packet.data(), &packet, sizeof(packet));
      std::memcpy(pnp_packet.data() + sizeof(packet), pixels.data(), pixels.size());
      DWORD pnp_written = 0;
      if (!WriteFile(pnp, pnp_packet.data(), static_cast<DWORD>(pnp_packet.size()),
                     &pnp_written, nullptr)) {
        CloseHandle(pnp);
        pnp = INVALID_HANDLE_VALUE;
      }
    }
    if (!frame || capacity < packet.bytes) {
      if (frame) UnmapViewOfFile(frame);
      if (frame_mapping) CloseHandle(frame_mapping);
      capacity = packet.bytes;
      ++generation;
      wchar_t name[96] = {};
      swprintf_s(name, L"Local\\CamPlayerVirtualCameraFrame-%lu-%ld",
                 GetCurrentProcessId(), generation);
      const std::uint64_t total = sizeof(FrameBlock) + static_cast<std::uint64_t>(capacity) * 2;
      frame_mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
          static_cast<DWORD>(total >> 32), static_cast<DWORD>(total), name);
      if (!frame_mapping) break;
      frame = static_cast<FrameBlock*>(MapViewOfFile(frame_mapping, FILE_MAP_ALL_ACCESS, 0, 0, 0));
      if (!frame) break;
      ZeroMemory(frame, sizeof(*frame));
      frame->version = kProtocolVersion;
      frame->capacity = capacity;
      wcsncpy_s(control->frame_mapping_name, name, _TRUNCATE);
      MemoryBarrier();
      InterlockedExchange(&control->generation, generation);
    }
    const LONG next = (frame->active_buffer + 1) & 1;
    auto* destination = reinterpret_cast<BYTE*>(frame + 1)
        + static_cast<std::size_t>(next) * capacity;
    std::memcpy(destination, pixels.data(), packet.bytes);
    frame->width = packet.width;
    frame->height = packet.height;
    frame->stride = packet.stride;
    frame->bytes = packet.bytes;
    frame->timestamp_us = packet.timestamp_us;
    control->source_width = packet.width;
    control->source_height = packet.height;
    control->fps_milli = packet.fps_milli;
    MemoryBarrier();
    InterlockedExchange(&frame->active_buffer, next);
    InterlockedIncrement(&frame->sequence);
    const BYTE acknowledgement = 1;
    DWORD written = 0;
    WriteFile(output, &acknowledgement, 1, &written, nullptr);
  }
  control->producer_pid = 0;
  if (pnp != INVALID_HANDLE_VALUE) CloseHandle(pnp);
  if (frame) UnmapViewOfFile(frame);
  if (frame_mapping) CloseHandle(frame_mapping);
  UnmapViewOfFile(control);
  CloseHandle(control_mapping);
  return 0;
}

int Status() {
  const bool installed = fs::exists(InstalledDll());
  LONG producer = 0, consumers = 0, width = 0, height = 0;
  LONG orientation = kOrientationPortrait;
  HANDLE mapping = OpenFileMappingW(FILE_MAP_READ, FALSE, kControlMappingName);
  if (mapping) {
    auto* control = static_cast<ControlBlock*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0,
                                                             sizeof(ControlBlock)));
    if (control) {
      producer = control->producer_pid;
      consumers = control->consumers;
      width = control->negotiated_width;
      height = control->negotiated_height;
      orientation = control->orientation;
      UnmapViewOfFile(control);
    }
    CloseHandle(mapping);
  }
  const bool pnp_installed = FindPnpDevice();
  HANDLE pnp = CreateFileW(kPnpControlPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  const bool pnp_ready = pnp != INVALID_HANDLE_VALUE;
  if (pnp_ready) CloseHandle(pnp);
  Print("{\"installed\":" + std::string(installed ? "true" : "false")
      + ",\"pnpInstalled\":" + (pnp_installed ? "true" : "false")
      + ",\"pnpReady\":" + (pnp_ready ? "true" : "false")
      + ",\"name\":\"" + JsonEscape(ReadName()) + "\",\"running\":"
      + (producer ? "true" : "false") + ",\"consumers\":" + std::to_string(consumers)
      + ",\"width\":" + std::to_string(width) + ",\"height\":"
      + std::to_string(height) + ",\"orientation\":\""
      + OrientationName(orientation) + "\"}\n");
  return 0;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
  std::vector<std::wstring> arguments;
  bool elevated = false;
  for (int index = 1; index < argc; ++index) {
    if (std::wstring(argv[index]) == L"--elevated") elevated = true;
    else arguments.emplace_back(argv[index]);
  }
  if (arguments.empty()) return 2;
  if (arguments[0] == L"serve") {
    return Serve(ParseOrientation(arguments.size() > 1 ? arguments[1] : L"portrait"));
  }
  if (arguments[0] == L"status") return Status();
  if (!elevated && !IsAdministrator()) return Elevate(arguments);
  return Mutate(arguments);
}
