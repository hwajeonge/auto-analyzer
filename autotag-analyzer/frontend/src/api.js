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