import React from "react";

export default function ResultView({ result }) {
  if (!result) {
    return <p>⏳ 분석 결과를 불러오는 중입니다...</p>;
  }

  const buttons = Array.isArray(result.buttons)
    ? result.buttons
    : [];

  return (
    <div>
      <h2 style={{ marginTop: 30 }}>
        🔘 버튼 분석 결과 ({buttons.length})
      </h2>

      {buttons.length === 0 && (
        <p>⚠️ 분석된 버튼이 없습니다.</p>
      )}

      {buttons.map((btn, i) => {
        const statusIcon = btn.hasClickEvent ? "🟢" : "🔴";
        const statusText = btn.hasClickEvent
          ? "GA4 click_event 있음"
          : "GA4 이벤트 없음";

        return (
          <div
            key={i}
            style={{
              marginBottom: 24,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 6
            }}
          >
            {/* Selector + 상태 */}
            <div style={{ marginBottom: 8 }}>
              <strong>
                {statusIcon} {btn.selector}
              </strong>
              <div style={{ fontSize: 12, color: "#666" }}>
                {statusText}
              </div>
            </div>

            {/* GA4 click_event 상세 */}
            <div style={{ marginTop: 12 }}>
              <strong>📡 GA4 click_event</strong>
              <pre
                style={{
                  background: "#eef6ff",
                  padding: 8,
                  marginTop: 6,
                  maxHeight: 200,
                  overflow: "auto"
                }}
              >
                {btn.events && btn.events.length > 0
                  ? JSON.stringify(btn.events, null, 2)
                  : "❌ 수집된 click_event 없음"}
              </pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
 