// One moment in the vertical pager: photo, or the ORIGINAL video when the moment has one.
import { memo, useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar.jsx';
import { CaptionPill } from '../components/CaptionPill.jsx';
import { MyReactions } from './Interactions.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago, fmtDuration, fullDate } from '../lib/format.js';

// Locket stores clips as HEVC (hvc1). Safari and many Chrome/Edge builds decode it; where the browser
// cannot (error, no picture, or stuck loading), the same clip is requested as H.264, which the server
// transcodes once and caches. Either way it is the original video, never the thumbnail.
export function MomentVideo({ src, poster, onState }) {
  const ref = useRef(null);
  const [source, setSource] = useState(src);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState({ t: 0, d: 0 });
  const fallback = useRef(false);

  const fail = () => {
    if (!fallback.current) {
      fallback.current = true;
      setShown(false);
      setSource(`${src}&v=h264`);
      return;
    }
    setFailed(true);
  };

  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    v.play().catch(() => {});
    const watchdog = setTimeout(() => { if (v.isConnected && v.readyState < 2) fail(); }, fallback.current ? 25000 : 6000);
    return () => clearTimeout(watchdog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => { onState?.({ muted, paused, failed }); }, [muted, paused, failed, onState]);

  if (failed) return <span className="verr">Không phát được video này</span>;
  const remaining = time.d ? fmtDuration(Math.max(0, time.d - time.t)) : '';
  return (
    <>
      <video ref={ref} src={source} poster={poster} loop muted={muted} playsInline autoPlay preload="auto"
        style={{ opacity: shown ? 1 : 0 }}
        onError={fail}
        onLoadedMetadata={(e) => { if (!e.currentTarget.videoWidth) fail(); else setTime({ t: 0, d: e.currentTarget.duration }); }}
        onPlaying={() => { setShown(true); setPaused(false); }}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => setTime({ t: e.currentTarget.currentTime, d: e.currentTarget.duration || 0 })}
        onClick={(e) => { e.stopPropagation(); const v = e.currentTarget; if (v.paused) v.play().catch(() => {}); else v.pause(); }} />
      <span className="vbar"><i style={{ width: time.d ? `${Math.min(100, (time.t / time.d) * 100)}%` : 0 }} /></span>
      <span className="vbadge"><Icon name="play" /><b>{remaining || 'Video'}</b></span>
      {paused && shown ? <span className="vpaused" aria-hidden="true"><Icon name="play" /></span> : null}
      <button type="button" className="mute" aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'} onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}>
        <Icon name={muted ? 'mute' : 'sound'} />
      </button>
    </>
  );
}

export const MomentPage = memo(function MomentPage({ moment: m, active, playingMusic, onMusic, onComments }) {
  return (
    <section className="page page-moment" data-id={m.id}>
      <div className="moment-media">
        <img src={m.image} alt={m.caption || `Khoảnh khắc của ${m.user.name}`} loading={active ? 'eager' : 'lazy'} decoding="async" draggable="false" />
        {m.video && active ? <MomentVideo src={m.video} poster={m.image} /> : null}
        {m.video && !active ? <span className="vbadge"><Icon name="play" /><b>Video</b></span> : null}
        <CaptionPill overlay={m.overlay} playing={playingMusic} onPlay={(url) => onMusic(m.id, url)} />
        {!m.mine ? <MyReactions list={m.myReactions} /> : null}
      </div>
      <div className="moment-meta">
        <Avatar user={m.user} />
        <span>{m.mine ? 'Bạn' : (m.user.firstName || m.user.name)}</span>
        <span className="ago" title={m.approxDate ? 'Thời gian ước lượng theo tin nhắn nhắc tới khoảnh khắc này' : fullDate(m.createdAt)}>
          {m.approxDate ? '≈ ' : ''}{ago(m.createdAt)}
        </span>
        {m.commentCount ? (
          <button type="button" className="cmt" aria-label="Bình luận" onClick={() => onComments(m)}><Icon name="chat" />{m.commentCount}</button>
        ) : null}
      </div>
    </section>
  );
});
