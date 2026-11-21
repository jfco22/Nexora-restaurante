import { Info } from 'lucide-react';
import '@/components/form-problem.css';

/** Explica por qué un formulario no se puede enviar y cómo corregirlo. No muestra nada si no hay problema. */
export function FormProblem({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="form-problem" role="status">
      <Info size={15} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
