package com.camexch.cameradiagnostics;

import android.hardware.Camera;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.media.ImageReader;
import android.os.Build;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.view.Surface;

import java.util.Arrays;
import java.util.List;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

public final class CameraDiagnosticsModule implements IXposedHookLoadPackage {
    private static final String TAG = "CamExchCameraDiag";

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) {
        if (lpparam.packageName.equals("com.camexch.cameradiagnostics")) {
            return;
        }
        log(lpparam.packageName, "loaded process=" + lpparam.processName);
        hookCamera1(lpparam);
        hookCamera2(lpparam);
        hookImageReader(lpparam);
        hookSurface(lpparam);
    }

    private static void hookCamera1(XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll("android.hardware.Camera", lpparam.classLoader, "open", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera1.open args=" + Arrays.toString(param.args));
            }
        });

        hookAll("android.hardware.Camera", lpparam.classLoader, "setParameters", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                if (param.args.length > 0 && param.args[0] instanceof Camera.Parameters) {
                    Camera.Parameters p = (Camera.Parameters) param.args[0];
                    Camera.Size preview = p.getPreviewSize();
                    Camera.Size picture = p.getPictureSize();
                    int[] fpsRange = new int[2];
                    p.getPreviewFpsRange(fpsRange);
                    log(lpparam.packageName, "Camera1.setParameters preview=" + cameraSize(preview)
                            + " picture=" + cameraSize(picture)
                            + " fpsRange=" + Arrays.toString(fpsRange)
                            + " focus=" + p.getFocusMode()
                            + " flash=" + p.getFlashMode());
                }
            }
        });

        hookAll("android.hardware.Camera", lpparam.classLoader, "startPreview", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera1.startPreview");
            }
        });

        hookAll("android.hardware.Camera", lpparam.classLoader, "stopPreview", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera1.stopPreview");
            }
        });

        hookAll("android.hardware.Camera", lpparam.classLoader, "release", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera1.release");
            }
        });
    }

    private static void hookCamera2(XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll("android.hardware.camera2.CameraManager", lpparam.classLoader, "getCameraIdList", new XC_MethodHook() {
            @Override
            protected void afterHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera2.getCameraIdList result=" + Arrays.toString((Object[]) param.getResult()));
            }
        });

        hookAll("android.hardware.camera2.CameraManager", lpparam.classLoader, "getCameraCharacteristics", new XC_MethodHook() {
            @Override
            protected void afterHookedMethod(MethodHookParam param) {
                Object result = param.getResult();
                if (result instanceof CameraCharacteristics) {
                    log(lpparam.packageName, "Camera2.getCameraCharacteristics id=" + param.args[0]
                            + " " + describeCharacteristics((CameraCharacteristics) result));
                }
            }
        });

        hookAll("android.hardware.camera2.CameraManager", lpparam.classLoader, "openCamera", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera2.openCamera id=" + param.args[0]
                        + " overloadArgs=" + param.args.length);
            }
        });

        hookAll("android.hardware.camera2.CameraDevice", lpparam.classLoader, "createCaptureRequest", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera2.createCaptureRequest camera=" + cameraDeviceId(param.thisObject)
                        + " template=" + param.args[0]);
            }
        });

        hookAll("android.hardware.camera2.CameraDevice", lpparam.classLoader, "createCaptureSession", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "Camera2.createCaptureSession camera=" + cameraDeviceId(param.thisObject)
                        + " surfaces=" + describeSurfaceList(param.args.length > 0 ? param.args[0] : null)
                        + " overloadArgs=" + param.args.length);
            }
        });

        if (Build.VERSION.SDK_INT >= 28) {
            hookAll("android.hardware.camera2.CameraDevice", lpparam.classLoader, "createCaptureSessionByOutputConfigurations", new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    log(lpparam.packageName, "Camera2.createCaptureSessionByOutputConfigurations camera="
                            + cameraDeviceId(param.thisObject) + " outputs=" + param.args[0]);
                }
            });
        }
    }

    private static void hookImageReader(XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll("android.media.ImageReader", lpparam.classLoader, "newInstance", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "ImageReader.newInstance width=" + param.args[0]
                        + " height=" + param.args[1]
                        + " format=" + param.args[2]
                        + " maxImages=" + param.args[3]
                        + " args=" + param.args.length);
            }
        });
    }

    private static void hookSurface(XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll("android.graphics.SurfaceTexture", lpparam.classLoader, "setDefaultBufferSize", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "SurfaceTexture.setDefaultBufferSize width=" + param.args[0]
                        + " height=" + param.args[1]);
            }
        });
    }

    private static void hookAll(String className, ClassLoader classLoader, String methodName, XC_MethodHook hook) {
        try {
            XposedBridge.hookAllMethods(XposedHelpers.findClass(className, classLoader), methodName, hook);
        } catch (Throwable t) {
            Log.w(TAG, "Hook unavailable " + className + "#" + methodName + ": " + t.getClass().getSimpleName());
        }
    }

    private static String describeCharacteristics(CameraCharacteristics c) {
        Integer lensFacing = c.get(CameraCharacteristics.LENS_FACING);
        int[] caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES);
        Range<Integer>[] fps = c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
        Size pixelArray = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE);
        Integer level = c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
        return "facing=" + lensFacingToText(lensFacing)
                + " pixelArray=" + size(pixelArray)
                + " hardwareLevel=" + level
                + " caps=" + Arrays.toString(caps)
                + " fps=" + Arrays.toString(fps);
    }

    private static String describeSurfaceList(Object value) {
        if (value instanceof List) {
            return "count=" + ((List<?>) value).size() + " " + value;
        }
        return String.valueOf(value);
    }

    private static String cameraDeviceId(Object cameraDevice) {
        if (cameraDevice instanceof CameraDevice) {
            return ((CameraDevice) cameraDevice).getId();
        }
        return String.valueOf(cameraDevice);
    }

    private static String lensFacingToText(Integer value) {
        if (value == null) {
            return "unknown";
        }
        if (value == CameraCharacteristics.LENS_FACING_FRONT) {
            return "front";
        }
        if (value == CameraCharacteristics.LENS_FACING_BACK) {
            return "back";
        }
        if (Build.VERSION.SDK_INT >= 23 && value == CameraCharacteristics.LENS_FACING_EXTERNAL) {
            return "external";
        }
        return String.valueOf(value);
    }

    private static String cameraSize(Camera.Size size) {
        return size == null ? "null" : size.width + "x" + size.height;
    }

    private static String size(Size size) {
        return size == null ? "null" : size.getWidth() + "x" + size.getHeight();
    }

    private static void log(String packageName, String message) {
        String line = "pkg=" + packageName + " " + message;
        Log.i(TAG, line);
        XposedBridge.log(TAG + " " + line);
    }
}
