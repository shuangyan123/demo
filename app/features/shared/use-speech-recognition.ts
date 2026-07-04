"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechRecognitionResult = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
};

type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

// 获取当前浏览器可用的语音识别构造器；识别只负责输入转写，不参与任何朗读回退。
function resolveSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

// 管理实时语音转写状态；只暴露文字稿，不保存或返回音频数据。
export function useSpeechRecognitionText({ unsupportedMessage }: { unsupportedMessage: string }) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [supported, setSupported] = useState(() => Boolean(resolveSpeechRecognition()));
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  // 启动浏览器语音识别；识别失败时保留手动输入兜底。
  const start = useCallback(() => {
    const Recognition = resolveSpeechRecognition();
    if (!Recognition) {
      setError(unsupportedMessage);
      setSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let nextText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        nextText += event.results[index][0].transcript;
      }
      setTranscript((current) => `${current}${nextText}`.trim());
    };
    recognition.onerror = () => {
      setError("语音识别中断，请切换文字输入或重新开始。");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  }, [unsupportedMessage]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError("");
  }, []);

  return useMemo(
    () => ({ error, listening, reset, setTranscript, start, stop, supported, transcript }),
    [error, listening, reset, start, stop, supported, transcript],
  );
}
