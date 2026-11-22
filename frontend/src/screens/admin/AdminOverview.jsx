// Admin Overview tab: KPI cards, 14/30-day SVG activity charts, and System Health / HF Backup status.
import { useMemo, useState } from 'react';
import { Icon } from '../../lib/icons.jsx';
import { ago } from '../../lib/format.js';

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function fmtUptime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} ngày ${h}g`;
  if (h > 0) return `${h} giờ ${m}p`;
  return `${m} phút`;
}

function TrendChart({ series, metric }) {
  const [pickedIdx, setPickedIdx] = useState(null);
  const W = 600;
  const H = 156;
  const padL = 28;
  const padR = 10;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const values = series.map((d) => (metric === 'dau' ? d.dau : d.moments));
  const maxVal = Math.max(1, ...values);
  const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW;
  const barW = Math.max(5, Math.min(20, (plotW / Math.max(1, series.length)) * 0.62));

  const points = series.map((d, i) => {
    const val = metric === 'dau' ? d.dau : d.moments;
    const x = padL + (series.length > 1 ? i * stepX : plotW / 2);
    const y = padT + plotH - (val / maxVal) * plotH;
    return { x, y, val, d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`
    : '';

  const active = pickedIdx !== null && points[pickedIdx] ? points[pickedIdx] : points[points.length - 1];
  const labelStride = series.length > 18 ? 5 : 2;

  return (
    <div className="adm-chart-wrap">
      <svg className="adm-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Biểu đồ hoạt động theo ngày">
        <defs>
          <linearGradient id="admAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((frac) => {
          const y = padT + plotH * (1 - frac);
          const lbl = Math.round(maxVal * frac);
          return (
            <g key={frac}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontWeight="700">{lbl}</text>
            </g>
          );
        })}

        {metric === 'moments' ? (
          points.map((p, i) => {
            const h = Math.max(p.val > 0 ? 3 : 0, padT + plotH - p.y);
            return (
              <rect
                key={p.d.date}
                x={p.x - barW / 2}
                y={padT + plotH - h}
                width={barW}
                height={h}
                rx="4"
                fill="var(--gold)"
                opacity={active?.d.date === p.d.date ? 1 : 0.72}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setPickedIdx(i)}
                onClick={() => setPickedIdx(i)}
              />
            );
          })
        ) : (
          <>
            {areaPath ? <path d={areaPath} fill="url(#admAreaGrad)" /> : null}
            {linePath ? <path d={linePath} fill="none" stroke="var(--gold)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {points.map((p, i) => (
              <g key={p.d.date} style={{ cursor: 'pointer' }} onMouseEnter={() => setPickedIdx(i)} onClick={() => setPickedIdx(i)}>
                <circle cx={p.x} cy={p.y} r="10" fill="transparent" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active?.d.date === p.d.date ? 5 : 2.8}
                  fill={active?.d.date === p.d.date ? 'var(--gold)' : 'var(--bg)'}
                  stroke="var(--gold)"
                  strokeWidth="2"
                />
              </g>
            ))}
          </>
        )}

        {points.map((p, i) => (
          (i % labelStride === 0 || i === points.length - 1) ? (
            <text key={`lbl-${p.d.date}`} x={p.x} y={H - 5} textAnchor="middle" fontSize="10" fill="var(--muted)" fontWeight="700">
              {p.d.label}
            </text>
          ) : null
        ))}
      </svg>

      {active ? (
        <div className="adm-chart-info">
          <span>Ngày <b>{active.d.date}</b></span>
          <span>
            DAU: <b>{active.d.dau}</b> · Đăng nhập: <b>{active.d.logins}</b> · Khoảnh khắc: <b>{active.d.moments}</b> · Tin nhắn: <b>{active.d.messages}</b> · Công cụ: <b>{active.d.tools}</b>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AdminOverview({ data, loading }) {
  const [range, setRange] = useState(14);
  const [metric, setMetric] = useState('dau');

  const series = useMemo(() => {
    const all = data?.series30 || [];
    return range === 14 ? all.slice(-14) : all;
  }, [data, range]);

  if (loading && !data) {
    return <div className="empty"><span className="spinner lg" /><span>Đang tải số liệu hệ thống…</span></div>;
  }
  if (!data) {
    return <div className="empty"><b>Chưa có dữ liệu</b>Hãy bấm làm mới để tải lại.</div>;
  }

  const { kpi, totals, today, health } = data;
  const toolsTotal = (totals.weather || 0) + (totals.music || 0) + (totals.places || 0) + (totals.exports || 0);
  const hf = health.hf || {};

  return (
    <>
      <section className="adm-section">
        <div className="adm-kpi-grid">
          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Đang Online (15p)</span><i className="adm-dot" /></div>
            <div className="adm-kpi-val">{kpi.onlineNow}</div>
            <div className="adm-kpi-sub">{kpi.activeSessions} phiên đang mở ({kpi.inMemorySessions} trên RAM)</div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Tổng người dùng</span><Icon name="people" /></div>
            <div className="adm-kpi-val">{kpi.totalUsers}</div>
            <div className="adm-kpi-sub">+{kpi.newToday} mới hôm nay · {kpi.bannedUsers} đã chặn</div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Hoạt động (DAU / WAU / MAU)</span><Icon name="activity" /></div>
            <div className="adm-kpi-val">{kpi.dau} <small style={{ fontSize: 15, color: 'var(--muted)' }}>/ {kpi.wau} / {kpi.mau}</small></div>
            <div className="adm-kpi-sub">{today.logins} lượt đăng nhập hôm nay</div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Khoảnh khắc qua Web</span><Icon name="camera" /></div>
            <div className="adm-kpi-val">{totals.moments}</div>
            <div className="adm-kpi-sub">{totals.photos} ảnh · {totals.videos} video · {totals.photobooth} photobooth</div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Tin nhắn đã gửi</span><Icon name="chat" /></div>
            <div className="adm-kpi-val">{totals.messages}</div>
            <div className="adm-kpi-sub">+{today.messages} tin nhắn hôm nay</div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Công cụ thông minh</span><Icon name="sparkles" /></div>
            <div className="adm-kpi-val">{toolsTotal}</div>
            <div className="adm-kpi-sub">Nhạc {totals.music} · Thời tiết {totals.weather} · Vị trí {totals.places} · ZIP {totals.exports}</div>
          </div>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head" style={{ marginTop: 0 }}>
            <h3><Icon name="chart" /> Xu hướng hoạt động</h3>
            <div className="adm-chart-controls">
              <div className="adm-pill-group">
                <button type="button" className={metric === 'dau' ? 'on' : ''} onClick={() => setMetric('dau')}>Người dùng (DAU)</button>
                <button type="button" className={metric === 'moments' ? 'on' : ''} onClick={() => setMetric('moments')}>Khoảnh khắc</button>
              </div>
              <div className="adm-pill-group">
                <button type="button" className={range === 14 ? 'on' : ''} onClick={() => setRange(14)}>14 ngày</button>
                <button type="button" className={range === 30 ? 'on' : ''} onClick={() => setRange(30)}>30 ngày</button>
              </div>
            </div>
          </div>
          <TrendChart series={series} metric={metric} />
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-section-head" style={{ marginTop: 0 }}>
              <h3><Icon name="activity" /> Sức khỏe Máy chủ</h3>
            </div>
            <div className="adm-kv-list">
              <div className="adm-kv"><span>Thời gian hoạt động (Uptime)</span><b>{fmtUptime(health.uptimeSec)}</b></div>
              <div className="adm-kv"><span>Độ trễ API trung bình / P95</span><b>{health.avgLatencyMs} ms / {health.p95LatencyMs} ms</b></div>
              <div className="adm-kv"><span>Tổng yêu cầu API</span><b>{health.requestsTotal.toLocaleString('vi-VN')}</b></div>
              <div className="adm-kv"><span>Lỗi máy chủ (5xx) / Khách (4xx)</span><b>{health.errors5xx} ({health.errorRatePct}%) / {health.errors4xx}</b></div>
              <div className="adm-kv">
                <span>Sao lưu Hugging Face</span>
                <b>
                  {hf.enabled
                    ? `${hf.encrypted ? 'AES · ' : ''}${hf.syncedFiles || 0} tệp${hf.lastSyncAt ? ` · ${ago(hf.lastSyncAt)}` : ''}`
                    : 'Chỉ lưu cục bộ'}
                </b>
              </div>
            </div>
          </div>

          <div className="adm-card">
            <div className="adm-section-head" style={{ marginTop: 0 }}>
              <h3><Icon name="cloud" /> Dung lượng Lưu trữ</h3>
            </div>
            <div className="adm-kv-list">
              <div className="adm-kv"><span>Ảnh thu nhỏ (thumbs/)</span><b>{fmtBytes(health.disk.thumbsBytes)}</b></div>
              <div className="adm-kv"><span>Video chuyển mã (videos/)</span><b>{fmtBytes(health.disk.videoBytes)}</b></div>
              <div className="adm-kv"><span>Lịch sử tài khoản (accounts/)</span><b>{fmtBytes(health.disk.accountsBytes)}</b></div>
              <div className="adm-kv"><span>Phiên đăng nhập (sessions/)</span><b>{fmtBytes(health.disk.sessionsBytes)}</b></div>
              <div className="adm-kv"><span>Dữ liệu quản trị (admin/)</span><b>{fmtBytes(health.disk.adminBytes)}</b></div>
              <div className="adm-kv"><span>Tổng cộng</span><b>{fmtBytes(health.disk.totalBytes)}</b></div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
