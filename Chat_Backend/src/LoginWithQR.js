import QRCode from 'qrcode';

function LoginWithQR({ sessionId }) {
  const [qrUrl, setQrUrl] = React.useState('');
  React.useEffect(() => {
    QRCode.toDataURL(sessionId, (err, url) => setQrUrl(url));
  }, [sessionId]);
  return <img src={qrUrl} alt="QR login" />;
}