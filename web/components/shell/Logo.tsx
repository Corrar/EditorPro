export default function Logo({ word = true, mark = true, onClick }: { word?: boolean; mark?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      {mark && <div className="mark"><span /><i /></div>}
      {word && <b>Editor<em>Pro</em></b>}
    </>
  );
  return onClick ? (
    <button type="button" className="ep-logo ep-logobtn" onClick={onClick} title="Meus projetos">{inner}</button>
  ) : (
    <div className="ep-logo">{inner}</div>
  );
}
