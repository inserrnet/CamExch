#pragma once

#include <cstdint>

namespace cam_player_vcam {

inline constexpr wchar_t kControlMappingName[] =
    L"Local\\CamPlayerVirtualCameraControl-v1";
inline constexpr wchar_t kRegistryPath[] =
    L"SOFTWARE\\CamPlayer\\VirtualCamera";
inline constexpr wchar_t kDefaultCameraName[] = L"Cam Player Camera";
inline constexpr std::uint32_t kProtocolVersion = 1;
inline constexpr std::uint32_t kPacketMagic = 0x4D415243; // CRAM
inline constexpr std::uint32_t kMaxDimension = 8192;

struct ControlBlock {
  std::uint32_t version;
  volatile long generation;
  volatile long producer_pid;
  volatile long consumers;
  volatile long source_width;
  volatile long source_height;
  volatile long fps_milli;
  volatile long negotiated_width;
  volatile long negotiated_height;
  wchar_t frame_mapping_name[96];
};

struct FrameBlock {
  std::uint32_t version;
  std::uint32_t capacity;
  volatile long sequence;
  volatile long active_buffer;
  volatile long width;
  volatile long height;
  volatile long stride;
  volatile long bytes;
  volatile long long timestamp_us;
  // Two equally sized RGBA buffers immediately follow this header.
};

struct PacketHeader {
  std::uint32_t magic;
  std::uint32_t width;
  std::uint32_t height;
  std::uint32_t stride;
  std::uint32_t fps_milli;
  std::uint32_t bytes;
  std::uint64_t timestamp_us;
};

} // namespace cam_player_vcam
