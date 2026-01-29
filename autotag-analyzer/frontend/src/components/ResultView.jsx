import React from "react";

export default function ResultView({ result }) {
  if (!result) {
    return <p>⏳ 분석 결과를 불러오는 중입니다...</p>;
  }

  const buttons = Array.isArray(result.buttons) ? result.buttons : [];
  const allEvents = Array.isArray(result.allEvents) ? result.allEvents : [];
  const clickEvents = allEvents.filter(e => e.eventName === "click_event");
  
  // 이벤트명별로 그룹화
  const eventsByType = allEvents.reduce((acc, event) => {
    const eventName = event.eventName || "unknown";
    if (!acc[eventName]) {
      acc[eventName] = [];
    }
    acc[eventName].push(event);
    return acc;
  }, {});

  // ep 배열에서 특정 키 찾기 헬퍼
  const getEpValue = (eventData, key) => {
    if (!eventData.ep || !Array.isArray(eventData.ep)) return null;
    const param = eventData.ep.find(p => p.key === key);
    return param ? param.value : null;
  };

  return (
    <div>
      {/* 요약 통계 */}
      <div
        style={{
          marginTop: 30,
          marginBottom: 30,
          padding: 16,
          background: "#f5f5f5",
          borderRadius: 8
        }}
      >
        <h2 style={{ marginTop: 0 }}>📊 분석 요약</h2>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div>
            <strong>클릭한 버튼 수:</strong> {result.buttonCount || buttons.length || 0}
          </div>
          <div>
            <strong>수집된 GA4 이벤트:</strong> {result.totalEvents || allEvents.length || 0}
          </div>
          <div>
            <strong>click_event:</strong> {result.totalClickEvents || clickEvents.length || 0}
          </div>
          <div>
            <strong>분석 시간:</strong>{" "}
            {result.analyzedAt
              ? new Date(result.analyzedAt).toLocaleString("ko-KR")
              : "-"}
          </div>
        </div>
      </div>

      {/* 모든 GA4 이벤트 목록 (이벤트 타입별) */}
      {Object.keys(eventsByType).length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <h2>📡 수집된 모든 GA4 이벤트 ({allEvents.length}개)</h2>
          
          {Object.entries(eventsByType).map(([eventName, events]) => (
            <div key={eventName} style={{ marginBottom: 30 }}>
              <h3 style={{ marginBottom: 12, color: eventName === "click_event" ? "#2c5aa0" : "#666" }}>
                🎯 {eventName} ({events.length}개)
              </h3>
              
              {events.map((event, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: 12,
                    padding: 16,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 6,
                    borderLeft: `4px solid ${eventName === "click_event" ? "#4a90e2" : "#888"}`
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ fontSize: 14 }}>이벤트 #{idx + 1}</strong>
                    {event.timestamp && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: "#666" }}>
                        {new Date(event.timestamp).toLocaleTimeString("ko-KR")}
                      </span>
                    )}
                    {event.url && (
                      <div style={{ marginTop: 4, fontSize: 12, color: "#888" }}>
                        {event.url}
                      </div>
                    )}
                  </div>

                  {/* 이벤트 파라미터 (ep) */}
                  {event.ep && Array.isArray(event.ep) && event.ep.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 13, color: "#2c5aa0" }}>
                        📋 이벤트 파라미터 (ep):
                      </strong>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 12,
                          background: "#f0f7ff",
                          borderRadius: 4,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                          gap: 8,
                          fontSize: 13
                        }}
                      >
                        {event.ep.map((param, pIdx) => (
                          <div key={pIdx}>
                            <strong style={{ color: "#2c5aa0" }}>{param.key}:</strong>{" "}
                            <span>{String(param.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 숫자형 이벤트 파라미터 (epn) */}
                  {event.epn && Array.isArray(event.epn) && event.epn.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 13, color: "#d97706" }}>
                        🔢 숫자형 이벤트 파라미터 (epn):
                      </strong>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 12,
                          background: "#fff7ed",
                          borderRadius: 4,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                          gap: 8,
                          fontSize: 13
                        }}
                      >
                        {event.epn.map((param, pIdx) => (
                          <div key={pIdx}>
                            <strong style={{ color: "#d97706" }}>{param.key}:</strong>{" "}
                            <span>{param.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 사용자 속성 (up) */}
                  {event.up && Array.isArray(event.up) && event.up.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 13, color: "#059669" }}>
                        👤 사용자 속성 (up):
                      </strong>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 12,
                          background: "#ecfdf5",
                          borderRadius: 4,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                          gap: 8,
                          fontSize: 13
                        }}
                      >
                        {event.up.map((param, pIdx) => (
                          <div key={pIdx}>
                            <strong style={{ color: "#059669" }}>{param.key}:</strong>{" "}
                            <span>{String(param.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ecommerce 파라미터 (eco) */}
                  {event.eco && Array.isArray(event.eco) && event.eco.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 13, color: "#7c3aed" }}>
                        💰 Ecommerce 파라미터 (eco):
                      </strong>
                      <div
                        style={{
                          marginTop: 8,
                          padding: 12,
                          background: "#f5f3ff",
                          borderRadius: 4,
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                          gap: 8,
                          fontSize: 13
                        }}
                      >
                        {event.eco.map((param, pIdx) => (
                          <div key={pIdx}>
                            <strong style={{ color: "#7c3aed" }}>{param.key}:</strong>{" "}
                            <span>{String(param.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 제품 정보 (products) */}
                  {event.products && Array.isArray(event.products) && event.products.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ fontSize: 13, color: "#dc2626" }}>
                        🛍️ 제품 정보 ({event.products.length}개):
                      </strong>
                      {event.products.map((product, prodIdx) => (
                        <div
                          key={prodIdx}
                          style={{
                            marginTop: 8,
                            padding: 12,
                            background: "#fef2f2",
                            borderRadius: 4,
                            border: "1px solid #fecaca"
                          }}
                        >
                          <strong style={{ fontSize: 12, color: "#dc2626" }}>
                            제품 #{prodIdx + 1}:
                          </strong>
                          <div
                            style={{
                              marginTop: 6,
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                              gap: 6,
                              fontSize: 12
                            }}
                          >
                            {Array.isArray(product) && product.map((item, itemIdx) => (
                              <div key={itemIdx}>
                                <strong>{item.key}:</strong> {String(item.value)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 메타 정보 */}
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee" }}>
                    <strong style={{ fontSize: 12, color: "#666" }}>메타 정보:</strong>
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        fontSize: 11,
                        color: "#888"
                      }}
                    >
                      {event.tid && <span>tid: {event.tid}</span>}
                      {event.cid && <span>cid: {event.cid}</span>}
                      {event.sid && <span>sid: {event.sid}</span>}
                      {event.dl && <span>dl: {event.dl.substring(0, 50)}...</span>}
                      {event.dt && <span>dt: {event.dt}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 버튼별 상세 결과 */}
      <h2 style={{ marginTop: 30 }}>
        🔘 버튼별 분석 결과 ({buttons.length})
      </h2>

      {buttons.length === 0 && <p>⚠️ 분석된 버튼이 없습니다.</p>}

      {buttons.map((btn, i) => {
        const hasEvents = btn.events && btn.events.length > 0;
        const statusIcon = hasEvents ? "🟢" : "🔴";
        const statusText = hasEvents
          ? `GA4 이벤트 있음 (${btn.events.length}개)`
          : "GA4 이벤트 없음";

        return (
          <div
            key={i}
            style={{
              marginBottom: 24,
              padding: 16,
              border: "1px solid #ddd",
              borderRadius: 6,
              background: hasEvents ? "#f9fff9" : "#fff"
            }}
          >
            {/* Selector + 상태 */}
            <div style={{ marginBottom: 12 }}>
              <strong style={{ fontSize: 16 }}>
                {statusIcon} {btn.selector || btn.fullSelector || "알 수 없음"}
              </strong>
              {btn.fullSelector && btn.fullSelector !== btn.selector && (
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  {btn.fullSelector}
                </div>
              )}
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                {statusText}
                {btn.url && (
                  <>
                    {" • "}
                    <span style={{ color: "#888" }}>{btn.url}</span>
                  </>
                )}
                {btn.depth !== undefined && (
                  <>
                    {" • "}
                    <span style={{ color: "#888" }}>깊이: {btn.depth}</span>
                  </>
                )}
              </div>
            </div>

            {/* 스크린샷 이미지 표시 */}
            {btn.screenshot && (
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                <strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                  📸 버튼 위치 (스크린샷)
                </strong>
                <div
                  style={{
                    border: "2px solid #ddd",
                    borderRadius: 6,
                    overflow: "hidden",
                    maxWidth: "100%",
                    background: "#fff"
                  }}
                >
                  <img
                    src={btn.screenshot}
                    alt={`${btn.selector} 위치`}
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                      maxHeight: "400px",
                      objectFit: "contain"
                    }}
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextSibling.style.display = "block";
                    }}
                  />
                  <div
                    style={{
                      display: "none",
                      padding: "20px",
                      textAlign: "center",
                      color: "#999"
                    }}
                  >
                    이미지 로드 실패
                  </div>
                </div>
              </div>
            )}

            {/* GA4 이벤트 상세 */}
            {btn.events && btn.events.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>📡 GA4 이벤트 ({btn.events.length}개)</strong>
                {btn.events.map((eventItem, eventIdx) => {
                  const eventData = eventItem.eventData || {};
                  const eventName = eventItem.eventName || eventData.en || "unknown";
                  
                  return (
                    <div
                      key={eventIdx}
                      style={{
                        background: "#eef6ff",
                        padding: 12,
                        marginTop: 8,
                        borderRadius: 4,
                        borderLeft: "3px solid #4a90e2"
                      }}
                    >
                      <div style={{ marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>이벤트명: {eventName}</strong>
                      </div>
                      
                      {/* click_event의 경우 기존처럼 표시 */}
                      {eventName === "click_event" && (
                        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                          <div>
                            <strong>ep_click_page:</strong>{" "}
                            {getEpValue(eventData, "ep_click_page") || (
                              <span style={{ color: "#999" }}>(없음)</span>
                            )}
                          </div>
                          <div>
                            <strong>ep_click_area:</strong>{" "}
                            {getEpValue(eventData, "ep_click_area") || (
                              <span style={{ color: "#999" }}>(없음)</span>
                            )}
                          </div>
                          <div>
                            <strong>ep_click_label:</strong>{" "}
                            {getEpValue(eventData, "ep_click_label") || (
                              <span style={{ color: "#999" }}>(없음)</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 다른 이벤트의 경우 모든 파라미터 표시 */}
                      {eventName !== "click_event" && eventData.ep && eventData.ep.length > 0 && (
                        <div style={{ fontSize: 12 }}>
                          <strong>이벤트 파라미터:</strong>
                          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {eventData.ep.map((param, pIdx) => (
                              <span key={pIdx} style={{ padding: "2px 6px", background: "#fff", borderRadius: 3 }}>
                                <strong>{param.key}:</strong> {String(param.value)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}