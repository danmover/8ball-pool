import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { Button, toast } from './kit';
import { Icon } from './Icon';

export function joinLink(code: string): string {
  return `${location.origin}/j/${code}`;
}

/** The room code, big and readable across a room, with a QR code and a share/copy button. */
export function InviteCard({ code, compact }: { code: string; compact?: boolean }): JSX.Element {
  const [qr, setQr] = useState('');
  const link = joinLink(code);
  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#0b1220', light: '#ffffff' } }).then(setQr);
  }, [link]);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join my pool table', text: `Join my 8-Ball Pool table — code ${code}`, url: link });
        return;
      }
    } catch {
      /* cancelled */
    }
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied', 'good', 'check');
    } catch {
      toast(link, 'info');
    }
  };

  return (
    <div class={`invite ${compact ? 'is-compact' : ''}`}>
      <div class="invite-text">
        <div class="invite-label">Room code</div>
        <div class="invite-code" aria-label={`Room code ${code.split('').join(' ')}`}>
          {code.split('').map((ch) => (
            <span>{ch}</span>
          ))}
        </div>
        <div class="invite-link">
          <Icon name="link" size={14} /> {link.replace(/^https?:\/\//, '')}
        </div>
        <Button kind="secondary" size="sm" icon={typeof navigator.share === 'function' ? 'share' : 'copy'} onClick={share}>
          {typeof navigator.share === 'function' ? 'Share invite' : 'Copy link'}
        </Button>
      </div>
      {qr && <img class="invite-qr" src={qr} alt="QR code to join" />}
    </div>
  );
}
