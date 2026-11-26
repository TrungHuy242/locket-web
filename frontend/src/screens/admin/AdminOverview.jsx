// Admin Overview v2: Vietnamese-first clickable KPIs with yesterday deltas, 4-metric 7/14/30d SVG chart,
// content breakdown & storage stacked bars, and Top 5 active members leaderboard.
import { useMemo, useState } from 'react';
import { Avatar } from '../../components/Avatar.jsx';
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

function DeltaPill({ cur, prev }) {
  const a = Number(cur) || 0;
  const b = Number(prev) || 0;
  if (a === 0 && b === 0) return <span className="adm-delta flat">Ổn định</span>;
  if (b === 0) return <span className="adm-delta up">+{a} hôm nay</span>;
  const diff = a - b;
  const pct = Math.round((diff / b) * 100);
  if (diff === 0) return <span className="adm-delta flat">= hôm qua</span>;
  return (
    <span className={`adm-delta ${diff > 0 ? 'up' : 'down'}`}>
      {diff > 0 ? `↑ +${pct}%` : `↓ ${pct}%`}
    </span>
  );
}

const CHART_METRICS = [
  ['dau', 'Người hoạt động', 'line'],
  ['moments', 'Khoảnh khắc', 'bar'],
  ['messages', 'Tin nhắn', 'bar'],
  ['tools', 'Công cụ thông minh', 'bar'],
];

function TrendChart({ series, metric }) {
  const [pickedIdx, setPickedIdx] = useState(null);
  const W = 640;
  const H = 166;
  const padL = 30;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const isBar = CHART_METRICS.find((m) => m[0] === metric)?.[2] === 'bar';
  const values = series.map((d) => Number(d[metric]) || 0);
  const maxVal = Math.max(1, ...values);
  const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW;
  const barW = Math.max(6, Math.min(26, (plotW / Math.max(1, series.length)) * 0.58));

  const points = series.map((d, i) => {
    const val = Number(d[metric]) || 0;
    const x = padL + (series.length > 1 ? i * stepX : plotW / 2);
    const y = padT + plotH - (val / maxVal) * plotH;
    return { x, y, val, d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`
    : '';

  const active = pickedIdx !== null && points[pickedIdx] ? points[pickedIdx] : points[points.length - 1];
  const labelStride = series.length > 20 ? 5 : series.length > 10 ? 2 : 1;

  return (
    <div className="adm-chart-wrap">
      <svg className="adm-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Biểu đồ xu hướng theo ngày">
        <defs>
          <linearGradient id="admAreaGradV2" x1="0" y1="0" x2="0" y2="1">
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

        {isBar ? (
          points.map((p, i) => {
            const h = Math.max(p.val > 0 ? 4 : 0, padT + plotH - p.y);
            return (
              <rect
                key={p.d.date}
                x={p.x - barW / 2}
                y={padT + plotH - h}
                width={barW}
                height={h}
                rx="5"
                fill="var(--gold)"
                opacity={active?.d.date === p.d.date ? 1 : 0.68}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setPickedIdx(i)}
                onClick={() => setPickedIdx(i)}
              />
            );
          })
        ) : (
          <>
            {areaPath ? <path d={areaPath} fill="url(#admAreaGradV2)" /> : null}
            {linePath ? <path d={linePath} fill="none" stroke="var(--gold)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" /> : null}
            {points.map((p, i) => (
              <g key={p.d.date} style={{ cursor: 'pointer' }} onMouseEnter={() => setPickedIdx(i)} onClick={() => setPickedIdx(i)}>
                <circle cx={p.x} cy={p.y} r="11" fill="transparent" />
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
            Hoạt động: <b>{active.d.dau}</b> · Đăng nhập: <b>{active.d.logins}</b> · Khoảnh khắc: <b>{active.d.moments}</b> · Tin nhắn: <b>{active.d.messages}</b> · Công cụ: <b>{active.d.tools}</b>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StackedBar({ items, total }) {
  const sum = total || items.reduce((acc, x) => acc + (x.value || 0), 0);
  return (
    <>
      <div className="adm-stack-bar">
        {sum > 0 ? items.filter((x) => x.value > 0).map((x) => (
          <div
            key={x.label}
            className="adm-stack-seg"
            style={{ width: `${Math.max(3, (x.value / sum) * 100)}%`, background: x.color }}
            title={`${x.label}: ${x.fmt || x.value}`}
          />
        )) : null}
      </div>
      <div className="adm-legend">
        {items.map((x) => (
          <span key={x.label} className="adm-legend-item">
            <i className="adm-legend-dot" style={{ background: x.color }} />
            <span>{x.label}: <b>{x.fmt || x.value}</b></span>
          </span>
        ))}
      </div>
    </>
  );
}

export function AdminOverview({ data, loading, onNavigate }) {
  const [range, setRange] = useState(14);
  const [metric, setMetric] = useState('dau');

  const series = useMemo(() => {
    const all = data?.series30 || [];
    return all.slice(-range);
  }, [data, range]);

  if (loading && !data) {
    return <div className="empty"><span className="spinner lg" /><span>Đang tải số liệu hệ thống…</span></div>;
  }
  if (!data) {
    return <div className="empty"><b>Chưa có dữ liệu</b>Hãy bấm làm mới ở góc trên để tải lại.</div>;
  }

  const { kpi, totals, today, yesterday = {}, topUsers = [], health } = data;
  const toolsTotal = (totals.weather || 0) + (totals.music || 0) + (totals.places || 0) + (totals.exports || 0);
  const hf = health.hf || {};
  const disk = health.disk || {};

  const contentSegments = [
    { label: 'Ảnh thường', value: Math.max(0, (totals.photos || 0) - (totals.photobooth || 0)), color: 'var(--gold)' },
    { label: 'Photobooth', value: totals.photobooth || 0, color: '#ff6b9d' },
    { label: 'Video', value: totals.videos || 0, color: '#0a84ff' },
  ];

  const diskSegments = [
    { label: 'Ảnh đệm', value: disk.thumbsBytes || 0, fmt: fmtBytes(disk.thumbsBytes), color: '#ffc629' },
    { label: 'Video đệm', value: disk.videoBytes || 0, fmt: fmtBytes(disk.videoBytes), color: '#ff6b9d' },
    { label: 'Lịch sử', value: disk.accountsBytes || 0, fmt: fmtBytes(disk.accountsBytes), color: '#0a84ff' },
    { label: 'Phiên & Admin', value: (disk.sessionsBytes || 0) + (disk.adminBytes || 0), fmt: fmtBytes((disk.sessionsBytes || 0) + (disk.adminBytes || 0)), color: '#30d158' },
  ];

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Tổng quan Hệ thống</h1>
          <p>Theo dõi lượng người dùng thực tế, hoạt động đăng khoảnh khắc và tình trạng máy chủ theo thời gian thực.</p>
        </div>
      </div>

      <section className="adm-section">
        <div className="adm-kpi-grid">
          <button type="button" className="adm-kpi" onClick={() => onNavigate?.('users', { filter: 'online' })}>
            <div className="adm-kpi-top"><span>Đang trực tuyến (15p)</span><i className="adm-dot" /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{kpi.onlineNow}</div>
              <span className="adm-delta flat">{kpi.activeSessions} phiên mở</span>
            </div>
            <div className="adm-kpi-sub">Bấm để xem ai đang online →</div>
          </button>

          <button type="button" className="adm-kpi" onClick={() => onNavigate?.('users', { filter: 'all' })}>
            <div className="adm-kpi-top"><span>Tổng người dùng</span><Icon name="people" /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{kpi.totalUsers}</div>
              {kpi.newToday > 0 ? <span className="adm-delta up">+{kpi.newToday} hôm nay</span> : <span className="adm-delta flat">0 mới hôm nay</span>}
            </div>
            <div className="adm-kpi-sub">{kpi.bannedUsers > 0 ? `${kpi.bannedUsers} tài khoản đang bị chặn` : 'Chưa có tài khoản bị chặn'}</div>
          </button>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Hoạt động hôm nay</span><Icon name="activity" /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{kpi.dau}</div>
              <DeltaPill cur={today.dau} prev={yesterday.dau} />
            </div>
            <div className="adm-kpi-sub">7 ngày: <b>{kpi.wau}</b> · 30 ngày: <b>{kpi.mau}</b> người</div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Khoảnh khắc qua Web</span><Icon name="camera" /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{totals.moments}</div>
              <DeltaPill cur={today.moments} prev={yesterday.moments} />
            </div>
            <div className="adm-kpi-sub">Hôm nay: <b>{today.moments}</b> · Photobooth: <b>{totals.photobooth}</b></div>
          </div>

          <div className="adm-kpi">
            <div className="adm-kpi-top"><span>Tin nhắn &amp; Công cụ</span><Icon name="sparkles" /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{totals.messages + toolsTotal}</div>
              <span className="adm-delta flat">+{today.messages + today.tools} hôm nay</span>
            </div>
            <div className="adm-kpi-sub">Tin nhắn: <b>{totals.messages}</b> · Nhạc/Thời tiết/Vị trí: <b>{toolsTotal}</b></div>
          </div>

          <button type="button" className="adm-kpi" onClick={() => onNavigate?.(kpi.openFeedback > 0 ? 'feedback' : 'users', kpi.openFeedback > 0 ? null : { filter: 'gold' })}>
            <div className="adm-kpi-top"><span>👑 VIP Gold &amp; Hộp thư</span><Icon name="crown" /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{kpi.goldUsers ?? 0}</div>
              {kpi.openFeedback > 0 ? (
                <span className="adm-delta down">{kpi.openFeedback} thư chờ xử lý</span>
              ) : (
                <span className="adm-delta up">Hộp thư sạch</span>
              )}
            </div>
            <div className="adm-kpi-sub">{kpi.openFeedback > 0 ? 'Bấm để duyệt yêu cầu Gold / góp ý →' : 'Bấm để xem thành viên VIP Gold →'}</div>
          </button>

          <button type="button" className="adm-kpi" onClick={() => onNavigate?.('ops')}>
            <div className="adm-kpi-top"><span>Sức khỏe Máy chủ</span><Icon name={health.errors5xx > 0 ? 'warning' : 'cloud'} /></div>
            <div className="adm-kpi-main">
              <div className="adm-kpi-val">{health.avgLatencyMs} <small style={{ fontSize: 14, color: 'var(--muted)' }}>ms</small></div>
              <span className={`adm-delta ${health.errors5xx > 0 ? 'down' : 'up'}`}>
                {health.errors5xx > 0 ? `${health.errors5xx} lỗi` : 'Khỏe mạnh'}
              </span>
            </div>
            <div className="adm-kpi-sub">Đĩa: <b>{fmtBytes(disk.totalBytes)}</b> · Bấm để vận hành →</div>
          </button>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head">
            <h3><Icon name="chart" /> Biểu đồ hoạt động theo ngày</h3>
            <div className="adm-chart-controls">
              <div className="adm-pill-group">
                {CHART_METRICS.map(([id, label]) => (
                  <button key={id} type="button" className={metric === id ? 'on' : ''} onClick={() => setMetric(id)}>{label}</button>
                ))}
              </div>
              <div className="adm-pill-group">
                {[7, 14, 30].map((days) => (
                  <button key={days} type="button" className={range === days ? 'on' : ''} onClick={() => setRange(days)}>{days} ngày</button>
                ))}
              </div>
            </div>
          </div>
          <TrendChart series={series} metric={metric} />
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="star" /> Top thành viên tích cực</h3>
              <button type="button" className="link-btn" onClick={() => onNavigate?.('users', { filter: 'all' })}>Xem tất cả →</button>
            </div>
            {!topUsers.length ? (
              <div className="empty" style={{ padding: '14px 4px' }}><span>Chưa có dữ liệu hoạt động.</span></div>
            ) : (
              <div className="adm-top-list">
                {topUsers.map((u, idx) => (
                  <button
                    key={u.uid}
                    type="button"
                    className="adm-top-row"
                    onClick={() => onNavigate?.('users', { focusUid: u.uid })}
                  >
                    <span className={`adm-rank ${idx === 0 ? 'r1' : ''}`}>{idx + 1}</span>
                    <Avatar user={u} />
                    <span className="adm-top-info">
                      <b>{u.name} {u.online ? '●' : ''}</b>
                      <small>{u.moments} bài · {u.messages} tin nhắn · {u.tools} công cụ</small>
                    </span>
                    <span className="adm-top-score">{u.logins} lần vào</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="cloud" /> Tỷ trọng nội dung &amp; Bộ nhớ</h3>
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>Phân bổ khoảnh khắc đã đăng ({totals.moments} bài)</div>
            <StackedBar items={contentSegments} total={totals.moments} />

            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginTop: 18 }}>
              Dung lượng ổ đĩa máy chủ ({fmtBytes(disk.totalBytes)})
            </div>
            <StackedBar items={diskSegments} total={disk.totalBytes} />

            <div className="adm-kv-list" style={{ marginTop: 14 }}>
              <div className="adm-kv"><span>Thời gian máy chủ chạy liên tục</span><b>{fmtUptime(health.uptimeSec)}</b></div>
              <div className="adm-kv">
                <span>Sao lưu đám mây (Hugging Face)</span>
                <b>{hf.enabled ? `${hf.encrypted ? 'Mã hóa AES · ' : ''}${hf.syncedFiles || 0} tệp${hf.lastSyncAt ? ` · ${ago(hf.lastSyncAt)}` : ''}` : 'Chưa bật'}</b>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
