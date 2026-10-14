/* Gedämpfte Feder (Masse–Feder–Dämpfer), numerisch integriert.
 *
 * Warum eine Simulation statt einer festen Kurve: Eine Feder kennt keine Dauer. Ändert sich das Ziel mitten in der
 * Bewegung, läuft sie vom aktuellen Wert mit der aktuellen Geschwindigkeit weiter – es gibt keinen Sprung und keinen
 * „Backstein“ beim Richtungswechsel. Genau das macht eine Bedienoberfläche unterbrechbar.
 *
 *   Spring(value, { stiffness, damping, mass })
 *   spring.target = x;  spring.step(dtSeconds);  spring.settled
 */

const SUBSTEP = 1 / 240;   // feste Teilschritte: stabil auch bei langen Frames
const MAX_FRAME = 1 / 20;  // nach einem Tab-Wechsel im Hintergrund nicht „aufholen“

export class Spring {
  constructor(value = 0, { stiffness = 300, damping = 25, mass = 1 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;
    this.restDistance = 0.05;  // px: näher als das gilt als angekommen
    this.restSpeed = 0.5;      // px/s
  }

  /** Federparameter ändern, ohne Position oder Geschwindigkeit anzutasten (z. B. beim Richtungswechsel). */
  configure({ stiffness = this.stiffness, damping = this.damping, mass = this.mass } = {}) {
    Object.assign(this, { stiffness, damping, mass });
    return this;
  }

  /** Sofort an den Wert springen (kein Übergang). */
  snap(value = this.target) {
    this.value = this.target = value;
    this.velocity = 0;
    return this;
  }

  get settled() {
    return Math.abs(this.target - this.value) < this.restDistance && Math.abs(this.velocity) < this.restSpeed;
  }

  /** Um dt Sekunden weiterrechnen, liefert den neuen Wert. */
  step(dt) {
    let left = Math.min(Math.max(dt, 0), MAX_FRAME);
    while (left > 1e-9) {
      const h = Math.min(SUBSTEP, left);
      const accel = (-this.stiffness * (this.value - this.target) - this.damping * this.velocity) / this.mass;
      this.velocity += accel * h;   // halb-implizites Euler-Verfahren: energiestabil
      this.value += this.velocity * h;
      left -= h;
    }
    if (this.settled) this.snap();
    return this.value;
  }
}

/** Dämpfungsgrad ζ: 1 = kein Überschwingen, < 1 = federt nach (ζ = c / 2√(k·m)). */
export const dampingRatio = ({ stiffness, damping, mass = 1 }) => damping / (2 * Math.sqrt(stiffness * mass));

/** Prozentuales Überschwingen einer unterdämpften Feder bei Sprung um 1 (0 bei ζ ≥ 1). */
export const overshoot = (spec) => {
  const z = dampingRatio(spec);
  return z >= 1 ? 0 : Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z));
};
