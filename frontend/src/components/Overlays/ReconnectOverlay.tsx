import styles from './Overlays.module.css';

interface ReconnectOverlayProps {
  visible: boolean;
}

export default function ReconnectOverlay({ visible }: ReconnectOverlayProps) {
  if (!visible) return null;

  return (
    <div className={styles.reconnect}>
      <div className={styles.spinner} />
      Reconnecting…
    </div>
  );
}
