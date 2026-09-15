#pragma once

#include <wdm.h>

#define CAM_PLAYER_FRAME_MAGIC 0x4D415243u
#define CAM_PLAYER_MAX_DIMENSION 8192u

#pragma pack(push, 1)
struct CAM_PLAYER_FRAME_PACKET {
    ULONG Magic;
    ULONG Width;
    ULONG Height;
    ULONG Stride;
    ULONG FpsMilli;
    ULONG Bytes;
    ULONGLONG TimestampUs;
};
#pragma pack(pop)

NTSTATUS CamPlayerFrameBridgeInitialize(_In_ PDRIVER_OBJECT DriverObject);
void CamPlayerFrameBridgeShutdown();

BOOLEAN CamPlayerCopyFrame(
    _Out_writes_bytes_(DestinationBytes) PUCHAR Destination,
    _In_ ULONG DestinationBytes,
    _In_ LONG Width,
    _In_ LONG Height,
    _In_ USHORT BitsPerPixel,
    _In_ ULONG Compression);

