export { approach, clamp, damp, deadzoneScale, lerp, smoothstep, wrapAngle, wrapAround } from './scalar'
export { interceptTime, raySphere } from './intersect'
export { makeRng, randomUnit, range, signed, weightedPick, type Rng } from './random'
// H³ на гиперболоиде Минковского. Экспортируется наружу, потому что РЕНДЕР куста
// проецирует узлы вселенной сам (`toBall`), а для этого ему нужна та же алгебра,
// что у домена: перенести кадр в игрока (`invertLorentz`, `applyMat`) и построить
// дуги-геодезические (`geodesicMidpoint`). Это чистая математика без знания об игре.
export {
  ORIGIN,
  applyMat,
  boost,
  distanceH,
  expMapOrigin,
  geodesicMidpoint,
  identity,
  invertLorentz,
  mdot,
  mulMat,
  normalizeH,
  rotate,
  toBall,
  vec4,
  type Mat4,
  type Vec4,
} from './hyperbolic'

// S³ — сетка гипертора и стереографическая проекция. Рядом с H³ (`hyperbolic`) и по той
// же причине: чистая математика, которую спрашивают и правила полёта, и рендер решётки.
export {
  applyPose,
  buildHypertorusGrid,
  identity4,
  mul4,
  orthonormalize4,
  rotPlaneW,
  slerpS3,
  stereoProject,
  type HypertorusGrid,
  type Pose4,
} from './hypertorus'
