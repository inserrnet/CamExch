package com.camexch.source;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class CamPlayerClientTest {
    @Test
    public void normalizesManualAddressAndDefaultPort() {
        assertEquals("http://192.168.4.10:8791",
                CamPlayerClient.normalizeAddress("192.168.4.10"));
        assertEquals("http://192.168.4.10:9000",
                CamPlayerClient.normalizeAddress("http://192.168.4.10:9000/ignored"));
    }
}
