package com.camexch.cameradiagnostics;

import android.hardware.Camera;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.OutputConfiguration;
import android.media.ImageReader;
import android.os.Build;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.view.Surface;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

public final class CameraDiagnosticsModule implements IXposedHookLoadPackage {
    private static final String TAG = "CamExchCameraDiag";
    private static final Set<String> LOGGED_ONCE = ConcurrentHashMap.newKeySet();

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) {
        if (lpparam.packageName.equals("com.camexch.cameradiagnostics")) {
            return;
        }
        log(lpparam.packageName, "loaded process=" + lpparam.processName);
        hookCamera1(lpparam);
        hookCamera2(lpparam);
        hookCamera2Implementations(lpparam);
        hookCaptureRequests(lpparam);
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
                Object result = param.getResult();
                if (result instanceof String[]) {
                    logOnce(lpparam.packageName, "camera-id-list",
                            "Camera2.getCameraIdList result=" + Arrays.toString((String[]) result));
                }
            }
        });

        hookAll("android.hardware.camera2.CameraManager", lpparam.classLoader, "getCameraCharacteristics", new XC_MethodHook() {
            @Override
            protected void afterHookedMethod(MethodHookParam param) {
                Object result = param.getResult();
                if (result instanceof CameraCharacteristics) {
                    String cameraId = String.valueOf(param.args[0]);
                    logOnce(lpparam.packageName, "characteristics-" + cameraId,
                            "Camera2.getCameraCharacteristics id=" + cameraId
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

    private static void hookCamera2Implementations(XC_LoadPackage.LoadPackageParam lpparam) {
        String cameraDeviceImpl = "android.hardware.camera2.impl.CameraDeviceImpl";
        hookSessionMethod(cameraDeviceImpl, "createCaptureSession", lpparam);
        hookSessionMethod(cameraDeviceImpl, "createCaptureSessionByOutputConfigurations", lpparam);
        hookSessionMethod(cameraDeviceImpl, "createReprocessableCaptureSession", lpparam);
        hookSessionMethod(cameraDeviceImpl, "createReprocessableCaptureSessionByConfigurations", lpparam);
        hookSessionMethod(cameraDeviceImpl, "createConstrainedHighSpeedCaptureSession", lpparam);
        hookSessionMethod(cameraDeviceImpl, "createCustomCaptureSession", lpparam);

        hookAll(cameraDeviceImpl, lpparam.classLoader, "createCaptureRequest", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "CameraDeviceImpl.createCaptureRequest camera="
                        + cameraDeviceId(param.thisObject)
                        + " template=" + firstArg(param.args));
            }
        });

        String sessionImpl = "android.hardware.camera2.impl.CameraCaptureSessionImpl";
        hookCaptureSessionMethod(sessionImpl, "setRepeatingRequest", lpparam);
        hookCaptureSessionMethod(sessionImpl, "setSingleRepeatingRequest", lpparam);
        hookCaptureSessionMethod(sessionImpl, "setRepeatingBurst", lpparam);
        hookCaptureSessionMethod(sessionImpl, "setRepeatingBurstRequests", lpparam);
        hookCaptureSessionMethod(sessionImpl, "capture", lpparam);
        hookCaptureSessionMethod(sessionImpl, "captureSingleRequest", lpparam);
        hookCaptureSessionMethod(sessionImpl, "captureBurst", lpparam);
        hookCaptureSessionMethod(sessionImpl, "captureBurstRequests", lpparam);
        hookSimpleSessionMethod(sessionImpl, "stopRepeating", lpparam);
        hookSimpleSessionMethod(sessionImpl, "abortCaptures", lpparam);
        hookSimpleSessionMethod(sessionImpl, "close", lpparam);
    }

    private static void hookCaptureRequests(XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll("android.hardware.camera2.CaptureRequest$Builder", lpparam.classLoader, "addTarget", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "CaptureRequest.Builder.addTarget " + describeSurface(firstArg(param.args)));
            }
        });

        hookAll("android.hardware.camera2.CaptureRequest$Builder", lpparam.classLoader, "removeTarget", new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "CaptureRequest.Builder.removeTarget " + describeSurface(firstArg(param.args)));
            }
        });

        hookAll("android.hardware.camera2.CaptureRequest$Builder", lpparam.classLoader, "build", new XC_MethodHook() {
            @Override
            protected void afterHookedMethod(MethodHookParam param) {
                if (param.getResult() instanceof CaptureRequest) {
                    log(lpparam.packageName, "CaptureRequest.Builder.build "
                            + describeCaptureRequest((CaptureRequest) param.getResult()));
                }
            }
        });
    }

    private static void hookSessionMethod(String className, String methodName,
            XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll(className, lpparam.classLoader, methodName, new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "CameraDeviceImpl." + methodName
                        + " camera=" + cameraDeviceId(param.thisObject)
                        + " outputs=" + describeSessionArguments(param.args));
            }
        });
    }

    private static void hookCaptureSessionMethod(String className, String methodName,
            XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll(className, lpparam.classLoader, methodName, new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "CameraCaptureSession." + methodName
                        + " session=" + sessionId(param.thisObject)
                        + " requests=" + describeRequests(param.args));
            }
        });
    }

    private static void hookSimpleSessionMethod(String className, String methodName,
            XC_LoadPackage.LoadPackageParam lpparam) {
        hookAll(className, lpparam.classLoader, methodName, new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                log(lpparam.packageName, "CameraCaptureSession." + methodName
                        + " session=" + sessionId(param.thisObject));
            }
        });
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
            return describeCollection((List<?>) value);
        }
        return String.valueOf(value);
    }

    private static String describeSessionArguments(Object[] args) {
        StringBuilder result = new StringBuilder();
        for (Object arg : args) {
            if (arg instanceof Collection) {
                appendDescription(result, describeCollection((Collection<?>) arg));
            } else if (arg instanceof Surface) {
                appendDescription(result, describeSurface(arg));
            } else if (Build.VERSION.SDK_INT >= 24 && arg instanceof OutputConfiguration) {
                appendDescription(result, describeOutputConfiguration((OutputConfiguration) arg));
            }
        }
        return result.length() == 0 ? "none args=" + args.length : result.toString();
    }

    private static String describeCollection(Collection<?> values) {
        StringBuilder result = new StringBuilder("count=").append(values.size()).append('[');
        boolean first = true;
        for (Object value : values) {
            if (!first) {
                result.append(", ");
            }
            first = false;
            if (value instanceof Surface) {
                result.append(describeSurface(value));
            } else if (Build.VERSION.SDK_INT >= 24 && value instanceof OutputConfiguration) {
                result.append(describeOutputConfiguration((OutputConfiguration) value));
            } else {
                result.append(value == null ? "null" : value.getClass().getSimpleName());
            }
        }
        return result.append(']').toString();
    }

    private static String describeOutputConfiguration(OutputConfiguration output) {
        try {
            return "OutputConfiguration{group=" + output.getSurfaceGroupId()
                    + ", rotation=" + output.getRotation()
                    + ", surfaces=" + describeCollection(output.getSurfaces()) + "}";
        } catch (Throwable t) {
            return "OutputConfiguration{" + t.getClass().getSimpleName() + "}";
        }
    }

    private static String describeRequests(Object[] args) {
        for (Object arg : args) {
            if (arg instanceof CaptureRequest) {
                return describeCaptureRequest((CaptureRequest) arg);
            }
            if (arg instanceof Collection) {
                StringBuilder result = new StringBuilder();
                for (Object value : (Collection<?>) arg) {
                    if (value instanceof CaptureRequest) {
                        appendDescription(result, describeCaptureRequest((CaptureRequest) value));
                    }
                }
                if (result.length() > 0) {
                    return result.toString();
                }
            }
        }
        return "none args=" + args.length;
    }

    private static String describeCaptureRequest(CaptureRequest request) {
        return "targets=" + describeCollection(request.getTargets())
                + " fps=" + request.get(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE)
                + " af=" + request.get(CaptureRequest.CONTROL_AF_MODE)
                + " ae=" + request.get(CaptureRequest.CONTROL_AE_MODE)
                + " crop=" + request.get(CaptureRequest.SCALER_CROP_REGION)
                + " jpegOrientation=" + request.get(CaptureRequest.JPEG_ORIENTATION)
                + " jpegQuality=" + request.get(CaptureRequest.JPEG_QUALITY);
    }

    private static String describeSurface(Object value) {
        if (!(value instanceof Surface)) {
            return String.valueOf(value);
        }
        Surface surface = (Surface) value;
        return "Surface@" + Integer.toHexString(System.identityHashCode(surface))
                + "{valid=" + surface.isValid() + "}";
    }

    private static String sessionId(Object session) {
        if (session instanceof CameraCaptureSession) {
            try {
                return String.valueOf(((CameraCaptureSession) session).getDevice().getId())
                        + "@" + Integer.toHexString(System.identityHashCode(session));
            } catch (Throwable ignored) {
                // Fall through to object identity when a vendor implementation is incomplete.
            }
        }
        return Integer.toHexString(System.identityHashCode(session));
    }

    private static Object firstArg(Object[] args) {
        return args.length == 0 ? null : args[0];
    }

    private static void appendDescription(StringBuilder result, String value) {
        if (result.length() > 0) {
            result.append(' ');
        }
        result.append(value);
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

    private static void logOnce(String packageName, String key, String message) {
        if (LOGGED_ONCE.add(packageName + ':' + key)) {
            log(packageName, message);
        }
    }
}
