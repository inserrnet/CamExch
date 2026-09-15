#include "avssamp.h"
#include "frame_bridge.h"

#include <wdmsec.h>

namespace {

constexpr ULONG kFramePoolTag = 'rFpC';
constexpr wchar_t kDeviceName[] = L"\\Device\\CamPlayerPnpCameraControl";
constexpr wchar_t kSymbolicName[] = L"\\DosDevices\\CamPlayerPnpCamera";

PDEVICE_OBJECT g_ControlDevice = nullptr;
PDRIVER_UNLOAD g_KsUnload = nullptr;
PDRIVER_DISPATCH g_KsCreate = nullptr;
PDRIVER_DISPATCH g_KsClose = nullptr;
PDRIVER_DISPATCH g_KsWrite = nullptr;
KSPIN_LOCK g_FrameLock;
PUCHAR g_Frame = nullptr;
ULONG g_FrameCapacity = 0;
ULONG g_FrameWidth = 0;
ULONG g_FrameHeight = 0;
ULONG g_FrameStride = 0;

NTSTATUS Complete(_In_ PIRP Irp, _In_ NTSTATUS Status, _In_ ULONG_PTR Information = 0) {
    Irp->IoStatus.Status = Status;
    Irp->IoStatus.Information = Information;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return Status;
}

UCHAR ClampByte(LONG value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return static_cast<UCHAR>(value);
}

void RgbToYuv(UCHAR red, UCHAR green, UCHAR blue, UCHAR* y, UCHAR* u, UCHAR* v) {
    *y = ClampByte(((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16);
    *u = ClampByte(((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128);
    *v = ClampByte(((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128);
}

NTSTATUS ControlCreateClose(_In_ PDEVICE_OBJECT DeviceObject, _In_ PIRP Irp) {
    if (DeviceObject == g_ControlDevice) return Complete(Irp, STATUS_SUCCESS);
    auto dispatch = IoGetCurrentIrpStackLocation(Irp)->MajorFunction == IRP_MJ_CREATE
        ? g_KsCreate : g_KsClose;
    return dispatch ? dispatch(DeviceObject, Irp) : Complete(Irp, STATUS_INVALID_DEVICE_REQUEST);
}

NTSTATUS ControlWrite(_In_ PDEVICE_OBJECT DeviceObject, _In_ PIRP Irp) {
    if (DeviceObject != g_ControlDevice) {
        return g_KsWrite ? g_KsWrite(DeviceObject, Irp)
                         : Complete(Irp, STATUS_INVALID_DEVICE_REQUEST);
    }
    const ULONG length = IoGetCurrentIrpStackLocation(Irp)->Parameters.Write.Length;
    if (!Irp->MdlAddress || length < sizeof(CAM_PLAYER_FRAME_PACKET)) {
        return Complete(Irp, STATUS_INVALID_BUFFER_SIZE);
    }
    auto packet = static_cast<const CAM_PLAYER_FRAME_PACKET*>(
        MmGetSystemAddressForMdlSafe(Irp->MdlAddress, NormalPagePriority | MdlMappingNoExecute));
    if (!packet) return Complete(Irp, STATUS_INSUFFICIENT_RESOURCES);

    const ULONGLONG expected = sizeof(*packet) + static_cast<ULONGLONG>(packet->Bytes);
    if (packet->Magic != CAM_PLAYER_FRAME_MAGIC || packet->Width < 2 || packet->Height < 2 ||
        packet->Width > CAM_PLAYER_MAX_DIMENSION || packet->Height > CAM_PLAYER_MAX_DIMENSION ||
        packet->Stride != packet->Width * 4 || packet->Bytes != packet->Stride * packet->Height ||
        expected != length) {
        return Complete(Irp, STATUS_INVALID_PARAMETER);
    }

    PUCHAR replacement = nullptr;
    if (packet->Bytes > g_FrameCapacity) {
        replacement = static_cast<PUCHAR>(
            ExAllocatePoolZero(NonPagedPool, packet->Bytes, kFramePoolTag));
        if (!replacement) return Complete(Irp, STATUS_INSUFFICIENT_RESOURCES);
    }

    KIRQL oldIrql;
    KeAcquireSpinLock(&g_FrameLock, &oldIrql);
    PUCHAR retired = nullptr;
    if (replacement) {
        retired = g_Frame;
        g_Frame = replacement;
        g_FrameCapacity = packet->Bytes;
    }
    RtlCopyMemory(g_Frame, packet + 1, packet->Bytes);
    g_FrameWidth = packet->Width;
    g_FrameHeight = packet->Height;
    g_FrameStride = packet->Stride;
    KeReleaseSpinLock(&g_FrameLock, oldIrql);
    if (retired) ExFreePool(retired);
    return Complete(Irp, STATUS_SUCCESS, length);
}

void ControlUnload(_In_ PDRIVER_OBJECT DriverObject) {
    CamPlayerFrameBridgeShutdown();
    if (g_KsUnload) g_KsUnload(DriverObject);
}

} // namespace

NTSTATUS CamPlayerFrameBridgeInitialize(_In_ PDRIVER_OBJECT DriverObject) {
    KeInitializeSpinLock(&g_FrameLock);
    UNICODE_STRING deviceName;
    UNICODE_STRING symbolicName;
    UNICODE_STRING sddl;
    RtlInitUnicodeString(&deviceName, kDeviceName);
    RtlInitUnicodeString(&symbolicName, kSymbolicName);
    RtlInitUnicodeString(&sddl, L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;WD)");
    const GUID controlClass =
        {0x9140f9db, 0x725a, 0x49cb, {0xa8, 0x63, 0x34, 0x30, 0xbe, 0xe4, 0x3c, 0x55}};
    NTSTATUS status = IoCreateDeviceSecure(
        DriverObject, 0, &deviceName, FILE_DEVICE_UNKNOWN, FILE_DEVICE_SECURE_OPEN,
        FALSE, &sddl, &controlClass, &g_ControlDevice);
    if (!NT_SUCCESS(status)) return status;
    g_ControlDevice->Flags |= DO_DIRECT_IO;
    g_ControlDevice->Flags &= ~DO_DEVICE_INITIALIZING;
    status = IoCreateSymbolicLink(&symbolicName, &deviceName);
    if (!NT_SUCCESS(status)) {
        IoDeleteDevice(g_ControlDevice);
        g_ControlDevice = nullptr;
        return status;
    }
    g_KsCreate = DriverObject->MajorFunction[IRP_MJ_CREATE];
    g_KsClose = DriverObject->MajorFunction[IRP_MJ_CLOSE];
    g_KsWrite = DriverObject->MajorFunction[IRP_MJ_WRITE];
    g_KsUnload = DriverObject->DriverUnload;
    DriverObject->MajorFunction[IRP_MJ_CREATE] = ControlCreateClose;
    DriverObject->MajorFunction[IRP_MJ_CLOSE] = ControlCreateClose;
    DriverObject->MajorFunction[IRP_MJ_WRITE] = ControlWrite;
    DriverObject->DriverUnload = ControlUnload;
    return STATUS_SUCCESS;
}

void CamPlayerFrameBridgeShutdown() {
    UNICODE_STRING symbolicName;
    RtlInitUnicodeString(&symbolicName, kSymbolicName);
    IoDeleteSymbolicLink(&symbolicName);
    if (g_ControlDevice) {
        IoDeleteDevice(g_ControlDevice);
        g_ControlDevice = nullptr;
    }
    if (g_Frame) {
        ExFreePool(g_Frame);
        g_Frame = nullptr;
    }
    g_FrameCapacity = 0;
    g_FrameWidth = g_FrameHeight = g_FrameStride = 0;
}

BOOLEAN CamPlayerCopyFrame(PUCHAR destination, ULONG destinationBytes, LONG width, LONG height,
                           USHORT bitsPerPixel, ULONG compression) {
    const ULONG outWidth = static_cast<ULONG>(width);
    const ULONG outHeight = static_cast<ULONG>(height < 0 ? -height : height);
    if (!destination || !outWidth || !outHeight) return FALSE;
    KIRQL oldIrql;
    KeAcquireSpinLock(&g_FrameLock, &oldIrql);
    if (!g_Frame || !g_FrameWidth || !g_FrameHeight) {
        KeReleaseSpinLock(&g_FrameLock, oldIrql);
        RtlZeroMemory(destination, destinationBytes);
        return FALSE;
    }

    if (bitsPerPixel == 24 && compression == KS_BI_RGB) {
        const ULONG rowBytes = ((outWidth * 3 + 3) / 4) * 4;
        if (static_cast<ULONGLONG>(rowBytes) * outHeight > destinationBytes) {
            KeReleaseSpinLock(&g_FrameLock, oldIrql);
            return FALSE;
        }
        for (ULONG y = 0; y < outHeight; ++y) {
            const ULONG sourceY = static_cast<ULONG>(
                (static_cast<ULONGLONG>(y) * g_FrameHeight) / outHeight);
            const ULONG destinationY = height < 0 ? y : outHeight - 1 - y;
            PUCHAR row = destination + destinationY * rowBytes;
            for (ULONG x = 0; x < outWidth; ++x) {
                const ULONG sourceX = static_cast<ULONG>(
                    (static_cast<ULONGLONG>(x) * g_FrameWidth) / outWidth);
                const PUCHAR source = g_Frame + sourceY * g_FrameStride + sourceX * 4;
                row[x * 3 + 0] = source[2];
                row[x * 3 + 1] = source[1];
                row[x * 3 + 2] = source[0];
            }
        }
    } else if (bitsPerPixel == 16 && compression == FOURCC_YUV422) {
        const ULONG rowBytes = outWidth * 2;
        if (static_cast<ULONGLONG>(rowBytes) * outHeight > destinationBytes) {
            KeReleaseSpinLock(&g_FrameLock, oldIrql);
            return FALSE;
        }
        for (ULONG y = 0; y < outHeight; ++y) {
            const ULONG sourceY = static_cast<ULONG>(
                (static_cast<ULONGLONG>(y) * g_FrameHeight) / outHeight);
            PUCHAR row = destination + y * rowBytes;
            for (ULONG x = 0; x + 1 < outWidth; x += 2) {
                UCHAR y0, u0, v0, y1, u1, v1;
                const ULONG sx0 = static_cast<ULONG>(
                    (static_cast<ULONGLONG>(x) * g_FrameWidth) / outWidth);
                const ULONG sx1 = static_cast<ULONG>(
                    (static_cast<ULONGLONG>(x + 1) * g_FrameWidth) / outWidth);
                const PUCHAR p0 = g_Frame + sourceY * g_FrameStride + sx0 * 4;
                const PUCHAR p1 = g_Frame + sourceY * g_FrameStride + sx1 * 4;
                RgbToYuv(p0[0], p0[1], p0[2], &y0, &u0, &v0);
                RgbToYuv(p1[0], p1[1], p1[2], &y1, &u1, &v1);
                row[x * 2 + 0] = static_cast<UCHAR>((static_cast<ULONG>(u0) + u1) / 2);
                row[x * 2 + 1] = y0;
                row[x * 2 + 2] = static_cast<UCHAR>((static_cast<ULONG>(v0) + v1) / 2);
                row[x * 2 + 3] = y1;
            }
        }
    } else {
        KeReleaseSpinLock(&g_FrameLock, oldIrql);
        RtlZeroMemory(destination, destinationBytes);
        return FALSE;
    }
    KeReleaseSpinLock(&g_FrameLock, oldIrql);
    return TRUE;
}

