import express from "express";
import cors from "cors";
import { analyzePage } from "./analyze.js";

const app = express();

app.use(cors());
app.use(express.json());

// SSE용 헤더 설정
app.use((req, res, next) => {
  if (req.path.includes('/stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  next();
});

app.post("/analyze", async (req, res) => {
  try {
    const { url } = req.body;
    
    // URL 유효성 검사
    if (!url) {
      return res.status(400).json({ error: "URL이 필요합니다." });
    }
    
    if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return res.status(400).json({ error: "유효한 URL 형식이 아닙니다. (http:// 또는 https://로 시작해야 합니다)" });
    }
    
    console.log(`\n📥 분석 요청 수신: ${url}`);
    
    // 타임아웃 설정 (10분)
    const timeout = 1800000; // 30분
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('요청 타임아웃: 분석이 30분을 초과했습니다.')), timeout);
    });
    
    const result = await Promise.race([
      analyzePage(url),
      timeoutPromise
    ]);
    
    res.json(result);
  } catch (e) {
    console.error('\n❌ 분석 오류:', e);
    const errorMessage = e.message || '알 수 없는 오류가 발생했습니다.';
    const statusCode = errorMessage.includes('타임아웃') || errorMessage.includes('timeout') ? 408 : 500;
    res.status(statusCode).json({ error: errorMessage });
  }
});

// 실시간 스트리밍 엔드포인트
app.post("/analyze-stream", async (req, res) => {
  try {
    const { url } = req.body;
    
    // URL 유효성 검사
    if (!url) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "URL이 필요합니다." })}\n\n`);
      res.end();
      return;
    }
    
    if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "유효한 URL 형식이 아닙니다." })}\n\n`);
      res.end();
      return;
    }
    
    console.log(`\n📥 실시간 분석 요청 수신: ${url}`);
    
    // 실시간 이벤트 전송 함수
    const sendEvent = (eventType, data) => {
      try {
        // 스크린샷은 너무 크므로 전송 시 제외
        let dataToSend = data;
        if (data && typeof data === 'object') {
          if (data.screenshot) {
            dataToSend = { ...data, screenshot: '[스크린샷 제외됨]' };
          } else if (data.buttons && Array.isArray(data.buttons)) {
            // buttons 배열의 각 항목에서 스크린샷 제외
            dataToSend = {
              ...data,
              buttons: data.buttons.map(btn => ({
                ...btn,
                screenshot: btn.screenshot ? '[스크린샷 제외됨]' : null
              }))
            };
          } else if (data.result && data.result.buttons) {
            // result.buttons 배열의 각 항목에서 스크린샷 제외
            dataToSend = {
              ...data,
              result: {
                ...data.result,
                buttons: data.result.buttons.map(btn => ({
                  ...btn,
                  screenshot: btn.screenshot ? '[스크린샷 제외됨]' : null
                }))
              }
            };
          }
        }
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(dataToSend)}\n\n`);
      } catch (e) {
        // JSON.stringify 실패 시 오류 처리
        console.error(`  ⚠ 이벤트 전송 실패 (${eventType}): ${e.message}`);
        // 스크린샷을 완전히 제거하고 재시도
        try {
          const dataWithoutScreenshot = JSON.parse(JSON.stringify(data, (key, value) => {
            return key === 'screenshot' ? '[스크린샷 제외됨]' : value;
          }));
          res.write(`event: ${eventType}\ndata: ${JSON.stringify(dataWithoutScreenshot)}\n\n`);
        } catch (e2) {
          console.error(`  ⚠ 이벤트 전송 재시도 실패: ${e2.message}`);
        }
      }
    };
    
    // analyzePage에 실시간 콜백 전달
    const result = await analyzePage(url, sendEvent);
    
    // 최종 결과 전송
    sendEvent('complete', result);
    res.end();
  } catch (e) {
    console.error('\n❌ 분석 오류:', e);
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

const PORT = 4000;

const server = app.listen(PORT, () => {
  console.log("✅ Playwright backend running on http://localhost:4000");
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ 포트 ${PORT}가 이미 사용 중입니다.`);
    console.error(`다음 명령어로 기존 프로세스를 종료하세요:`);
    console.error(`  lsof -ti:${PORT} | xargs kill -9`);
    console.error(`또는 다른 포트를 사용하도록 PORT 환경 변수를 설정하세요.\n`);
    process.exit(1);
  } else {
    console.error('서버 시작 오류:', error);
    process.exit(1);
  }
});