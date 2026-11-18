export default function Logo({ word = true, onClick }: { word?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <div className="mark"><span /><i /></div>
      {word && <b>Editor<em>Pro</em></b>}
    </>
  );
  return onClick ? (
    <button type="button" className="ep-logo ep-logobtn" onClick={onClick} title="Meus projetos">{inner}</button>
  ) : (
    <div className="ep-logo">{inner}</div>
  );
}
