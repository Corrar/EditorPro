/* marca: ícone do app (/icon.svg) + nome */
export default function Logo({ word = true, mark = true, onClick }: { word?: boolean; mark?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      {mark && <img className="ep-appicon" src="/icon.svg" alt="" width={36} height={36} />}
      {word && <b>Editor<em>Pro</em></b>}
    </>
  );
  return onClick ? (
    <button type="button" className="ep-logo ep-logobtn" onClick={onClick} title="Início" aria-label="EditorPro — início">{inner}</button>
  ) : (
    <div className="ep-logo">{inner}</div>
  );
}
