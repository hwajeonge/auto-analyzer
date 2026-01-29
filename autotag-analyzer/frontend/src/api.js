export async function analyzeUrl(url) {
    const res = await fetch("http://localhost:4000/analyze", {

        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({url})
    });

    const text = await res.text();

    if(!res.ok) {
        console.error("Analyze API Error:", text);
        throw new Error("페이지 분석 실패");
    }

    if (!text) {
        throw new Error("server에서 빈 응답 return")
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch(e) {
        console.error("Invalid JSON:", text);
        throw new Error("서버 응답이 올바른 JSON이 아님");
    }

    return {
        url: data.url,
        analyzedAt: data.analyzedAt,
        buttonCount: data.buttonCount ?? 0,
        buttons: Array.isArray(data.buttons) ? data.buttons : []
    };
}

// 실시간 스트리밍 분석
export async function analyzeUrlStream(url, onEvent) {
    const res = await fetch("http://localhost:4000/analyze-stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({url})
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "스트리밍 분석 실패");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            
            // SSE 메시지 파싱
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || ''; // 마지막 불완전한 메시지는 버퍼에 보관

            for (const line of lines) {
                if (!line.trim()) continue;
                
                let eventType = 'message';
                let dataStr = '';

                for (const part of line.split('\n')) {
                    if (part.startsWith('event: ')) {
                        eventType = part.substring(7);
                    } else if (part.startsWith('data: ')) {
                        dataStr = part.substring(6);
                    }
                }

                if (dataStr) {
                    try {
                        const data = JSON.parse(dataStr);
                        onEvent(eventType, data);
                    } catch (e) {
                        console.error('SSE 데이터 파싱 오류:', e, dataStr);
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}