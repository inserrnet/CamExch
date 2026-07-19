package com.camexch.source;

interface WebRtcSessionPublisher {
    String answerOffer(String offerSdp) throws Exception;

    void release();
}
