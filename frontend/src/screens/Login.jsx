// Welcome -> email -> password, mirroring Locket's sign-in flow. Sign-in always goes to the real Locket API.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../lib/icons.jsx';
import { useSiteConfig } from '../lib/siteConfig.js';
import { Button } from '../ui/kit.jsx';

const STEPS = ['welcome', 'email', 'password'];

function Brand({ appName, tagline }) {
  return (
    <>
      <div className="brand"><span className="brand-mark"><Icon name="heart" /></span>{appName}</div>
      <p className="tagline">{tagline}</p>
    </>
  );
}

export function Login({ onAuthenticated }) {
  const site = useSiteConfig((s) => s);
  const [step, setStep] = useState('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const emailRef = useRef(null);
  const passRef = useRef(null);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const go = (name) => { setStep(name); setError(''); };
  useEffect(() => {
    const target = step === 'email' ? emailRef.current : step === 'password' ? passRef.current : null;
    if (!target) return undefined;
    const t = setTimeout(() => target.focus({ preventScroll: true }), 420);
    return () => clearTimeout(t);
  }, [step]);

  const position = (name) => {
    if (name === step) return '';
    return STEPS.indexOf(name) < STEPS.indexOf(step) ? 'off-left' : 'off-right';
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      const session = await api.login(email.trim(), password, inviteCode.trim());
      setPassword('');
      onAuthenticated(session);
    } catch (err) {
      // real failures are shown as they are: wrong credentials, rate limit, or Locket unreachable
      setError(err.message);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-art"><Brand appName={site.appName} tagline={site.tagline} /></div>
      <div className="auth-steps">
        <section className={`auth-step welcome ${position('welcome')}`}>
          <div className="welcome-brand"><Brand appName={site.appName} tagline={site.tagline} /></div>
          <h1>Chào mừng đến với {site.appName}</h1>
          <p className="tagline sub">Đăng nhập bằng tài khoản Locket của bạn để xem khoảnh khắc của bạn bè và gửi ảnh.</p>
          {site.maintenance?.enabled ? (
            <div className="auth-invite-pill"><Icon name="wrench" /> {site.maintenance.message}</div>
          ) : site.inviteOnly ? (
            <div className="auth-invite-pill"><Icon name="lock" /> Chế độ riêng tư · Chỉ dành cho người được mời</div>
          ) : null}
          <button type="button" className="btn btn-gold" onClick={() => go('email')}>Đăng nhập</button>
          <p className="auth-note">{site.footerCredit}</p>
        </section>

        <section className={`auth-step ${position('email')}`}>
          <button type="button" className="icon-btn auth-back pressable" aria-label="Quay lại" onClick={() => go('welcome')}><Icon name="chevLeft" /></button>
          <form className="auth-form" noValidate onSubmit={(e) => { e.preventDefault(); if (validEmail) go('password'); }}>
            <h1>Email của bạn là gì?</h1>
            <label className="field"><input ref={emailRef} type="email" name="email" placeholder="Địa chỉ email" autoComplete="username" autoCapitalize="none" spellCheck={false} inputMode="email"
              value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <p className="auth-error" />
            <button className="btn btn-gold btn-block" disabled={!validEmail}>Tiếp tục <Icon name="arrowRight" /></button>
          </form>
        </section>

        <section className={`auth-step ${position('password')}`}>
          <button type="button" className="icon-btn auth-back pressable" aria-label="Quay lại" onClick={() => go('email')}><Icon name="chevLeft" /></button>
          <form className="auth-form" noValidate onSubmit={submit}>
            <h1>Nhập mật khẩu của bạn</h1>
            <label key={shake} className={`field ${shake ? 'shake' : ''}`}>
              <input ref={passRef} type={reveal ? 'text' : 'password'} name="password" placeholder="Mật khẩu" autoComplete="current-password"
                value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} />
              <button type="button" onClick={() => setReveal((r) => !r)}>{reveal ? 'Ẩn' : 'Hiện'}</button>
            </label>
            {site.inviteOnly ? (
              <label className="field" style={{ marginTop: 10 }}>
                <input
                  type="text"
                  name="inviteCode"
                  placeholder="Mã mời (vd: LCK-XXXXXX)"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={inviteCode}
                  onChange={(e) => { setInviteCode(e.target.value.toUpperCase()); setError(''); }}
                />
              </label>
            ) : null}
            <p className="auth-error">{error}</p>
            <p className="auth-hint">Quên mật khẩu? Hãy đặt lại trong ứng dụng Locket trên điện thoại.</p>
            <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!password}>
              Tiếp tục <Icon name="arrowRight" />
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
