const embedThemeLockScript = `
(function () {
    document.documentElement.dataset.theme = "light";
})();
`;

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: embedThemeLockScript }} />
      {children}
    </>
  );
}

