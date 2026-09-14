cmake_minimum_required(VERSION 3.24)
project(CamPlayerVirtualCamera LANGUAGES CXX)

if(NOT WIN32)
  message(FATAL_ERROR "Cam Player virtual camera is Windows-only")
endif()
if(NOT DEFINED BASECLASSES_DIR)
  message(FATAL_ERROR "Set BASECLASSES_DIR to the Microsoft DirectShow BaseClasses directory")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
  _CRT_SECURE_NO_WARNINGS STRSAFE_NO_DEPRECATE)

set(BASECLASS_SOURCES
  amextra.cpp amfilter.cpp amvideo.cpp arithutil.cpp combase.cpp cprop.cpp
  ctlutil.cpp ddmm.cpp dllentry.cpp dllsetup.cpp mtype.cpp outputq.cpp
  perflog.cpp pstream.cpp pullpin.cpp refclock.cpp renbase.cpp schedule.cpp
  seekpt.cpp source.cpp strmctl.cpp sysclock.cpp transfrm.cpp transip.cpp
  videoctl.cpp vtrans.cpp winctrl.cpp winutil.cpp wxdebug.cpp wxlist.cpp wxutil.cpp)
list(TRANSFORM BASECLASS_SOURCES PREPEND "${BASECLASSES_DIR}/")

add_library(dshow_baseclasses STATIC ${BASECLASS_SOURCES})
target_include_directories(dshow_baseclasses PUBLIC "${BASECLASSES_DIR}")
target_compile_options(dshow_baseclasses PRIVATE /W0 /permissive-)

add_library(CamPlayerVirtualCamera SHARED
  src/virtual_camera_filter.cpp
  src/virtual_camera_filter.def)
target_include_directories(CamPlayerVirtualCamera PRIVATE include)
target_link_libraries(CamPlayerVirtualCamera PRIVATE dshow_baseclasses
  strmiids ole32 oleaut32 uuid winmm)
set_target_properties(CamPlayerVirtualCamera PROPERTIES
  OUTPUT_NAME "CamPlayerVirtualCamera"
  PREFIX "")

add_executable(CamPlayerVirtualCameraControl src/virtual_camera_control.cpp)
target_include_directories(CamPlayerVirtualCameraControl PRIVATE include)
target_link_libraries(CamPlayerVirtualCameraControl PRIVATE advapi32 ole32 shell32)

install(TARGETS CamPlayerVirtualCamera CamPlayerVirtualCameraControl
  RUNTIME DESTINATION . LIBRARY DESTINATION .)
