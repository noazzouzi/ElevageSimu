export function Placeholder({ title }: { title: string }) {
  return (
    <div className="card empty">
      <h2>{title}</h2>
      <p>Cette section est en cours de construction.</p>
    </div>
  )
}
