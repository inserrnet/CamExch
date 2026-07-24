package com.camexch.source;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;

final class CamPlayerDiscovery {
    interface Listener {
        void onEndpoint(String name, String address);
        void onError(String message);
    }

    private static final String SERVICE_TYPE = "_camexch._tcp.";

    private final NsdManager manager;
    private final Listener listener;
    private NsdManager.DiscoveryListener discoveryListener;

    CamPlayerDiscovery(Context context, Listener listener) {
        manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        this.listener = listener;
    }

    void start() {
        stop();
        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (!serviceInfo.getServiceType().startsWith("_camexch._tcp")) {
                    return;
                }
                manager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo service, int errorCode) {
                        listener.onError("Cam Player resolve failed: " + errorCode);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo service) {
                        if (service.getHost() == null) {
                            return;
                        }
                        String host = service.getHost().getHostAddress();
                        listener.onEndpoint(
                                service.getServiceName(),
                                host + ":" + service.getPort()
                        );
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                listener.onError("Cam Player discovery failed: " + errorCode);
                stop();
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
            }
        };
        manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
    }

    void stop() {
        if (discoveryListener == null) {
            return;
        }
        try {
            manager.stopServiceDiscovery(discoveryListener);
        } catch (IllegalArgumentException ignored) {
        }
        discoveryListener = null;
    }
}
