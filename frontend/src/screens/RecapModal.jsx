// Personal Locket Recap & Statistics modal (total counts, posting streaks, 12-month bar chart, top friends).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { Spinner, StateView } from '../ui/kit.jsx';

function RecapBody({ close }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api.memoriesStats().then(setData).catch((err) => setError(err.message));
  };

  useEffect(() => { load(); }, []);

  if (!data && !error) return <div className="empty" style={{ padding: '48px 0' }}><Spinner size="lg" /></div>;
  if (!data) return <StateView icon="chart" tone="error" title="Không tải được thống kê" text={error} action="Thử lại" onAction={load} />;

  const maxMonth = Math.max(1, ...(data.monthly || []).map((m) => m.total));

  return (
    <div className="recap">
      <div className="sheet-title">Thống kê Locket</div>
      <div className="sheet-sub">Tổng hợp từ {data.total} khoảnh khắc đã đồng bộ của bạn</div>

      <div className="recap-cards">
        <div className="recap-card gold">
          <b>{data.myStreak}</b>
          <span>🔥 Chuỗi ngày đăng</span>
          <small>Kỷ lục: {data.myLongestStreak} ngày</small>
        </div>
        <div className="recap-card">
          <b>{data.total}</b>
          <span>Tổng khoảnh khắc</span>
          <small>{data.photos} ảnh · {data.videos} video</small>
        </div>
        <div className="recap-card">
          <b>{data.mineCount}</b>
          <span>Bạn đã gửi</span>
          <small>{data.friendsCount} từ bạn bè</small>
        </div>
        <div className="recap-card">
          <b>{data.activeDays}</b>
          <span>Ngày có kỷ niệm</span>
          <small>Chuỗi chung: {data.currentStreak} ngày</small>
        </div>
      </div>

      <div className="section-label"><Icon name="chart" /> 12 tháng gần nhất</div>
      <div className="recap-bars" role="img" aria-label="Biểu đồ khoảnh khắc 12 tháng gần nhất">
        {(data.monthly || []).map((m) => {
          const pct = m.total ? Math.max(8, Math.round((m.total / maxMonth) * 100)) : 3;
          return (
            <div key={`${m.year}-${m.month}`} className="recap-col" title={`Tháng ${m.month}/${m.year}: ${m.total} (${m.photos} ảnh, ${m.videos} video)`}>
              <span className="val">{m.total || ''}</span>
              <div className="track"><i style={{ height: `${pct}%` }} className={m.total ? 'on' : ''} /></div>
              <span className="lbl">{m.label}</span>
            </div>
          );
        })}
      </div>

      {data.topFriends?.length ? (
        <>
          <div className="section-label"><Icon name="people" /> Bạn thân tương tác nhiều nhất</div>
          <div className="recap-top">
            {data.topFriends.map((f, i) => (
              <button key={f.user.uid} type="button" className="person" onClick={() => { close(); nav.push('friend', { uid: f.user.uid, user: f.user }); }}>
                <span className={`rank r${i + 1}`}>{i + 1}</span>
                <Avatar user={f.user} />
                <div className="who">
                  {f.user.name}
                  <small>{f.moments} khoảnh khắc · {f.comments} bình luận</small>
                </div>
                <span className="chev"><Icon name="chevRight" /></span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function openRecap() {
  ui.sheet(({ close }) => <RecapBody close={close} />, { full: true });
}
