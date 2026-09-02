export function SupportLink({ href = '/support/verification', children = 'Contact support' }: {
  href?: string;
  children?: string;
}) {
  return (
    <a className="siv-link" href={href} rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default SupportLink;
