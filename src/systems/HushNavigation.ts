import * as THREE from 'three';

interface OpenNode {
  id: number;
  cost: number;
}

export function findGridPath(
  start: THREE.Vector3,
  target: THREE.Vector3,
  canStandAt: (position: THREE.Vector3) => boolean,
  cellSize = 0.7,
  margin = 4,
): THREE.Vector3[] {
  const minX = Math.floor((Math.min(start.x, target.x) - margin) / cellSize) * cellSize;
  const minZ = Math.floor((Math.min(start.z, target.z) - margin) / cellSize) * cellSize;
  const columns = Math.ceil((Math.max(start.x, target.x) + margin - minX) / cellSize) + 1;
  const rows = Math.ceil((Math.max(start.z, target.z) + margin - minZ) / cellSize) + 1;
  if (columns * rows > 12000) return [];

  const idAt = (x: number, z: number) => x * rows + z;
  const positionAt = (id: number) => {
    const x = Math.floor(id / rows);
    const z = id % rows;
    return new THREE.Vector3(minX + x * cellSize, start.y, minZ + z * cellSize);
  };
  const coordinatesAt = (position: THREE.Vector3) => ({
    x: THREE.MathUtils.clamp(Math.round((position.x - minX) / cellSize), 0, columns - 1),
    z: THREE.MathUtils.clamp(Math.round((position.z - minZ) / cellSize), 0, rows - 1),
  });
  const passable = new Map<number, boolean>();
  const canOccupy = (id: number): boolean => {
    const cached = passable.get(id);
    if (cached !== undefined) return cached;
    const result = canStandAt(positionAt(id));
    passable.set(id, result);
    return result;
  };

  const startGrid = coordinatesAt(start);
  const goalGrid = coordinatesAt(target);
  const nearestPassable = (grid: { x: number; z: number }, point: THREE.Vector3, radius: number): number | null => {
    let best: number | null = null;
    let bestDistance = Infinity;
    for (let ring = 0; ring <= radius; ring++) {
      for (let x = Math.max(0, grid.x - ring); x <= Math.min(columns - 1, grid.x + ring); x++) {
        for (let z = Math.max(0, grid.z - ring); z <= Math.min(rows - 1, grid.z + ring); z++) {
          if (Math.max(Math.abs(x - grid.x), Math.abs(z - grid.z)) !== ring) continue;
          const id = idAt(x, z);
          if (!canOccupy(id)) continue;
          const distance = positionAt(id).distanceToSquared(point);
          if (distance < bestDistance) {
            best = id;
            bestDistance = distance;
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  };

  const startId = nearestPassable(startGrid, start, 2);
  const goalId = nearestPassable(goalGrid, target, Math.ceil(1.5 / cellSize));
  if (startId === null) return [];
  if (goalId !== null && startId === goalId) return [positionAt(goalId)];

  const goalPosition = goalId === null ? target : positionAt(goalId);
  const heuristic = (id: number) => positionAt(id).distanceTo(goalPosition) / cellSize;
  const open: OpenNode[] = [];
  const scores = new Map<number, number>([[startId, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const push = (node: OpenNode) => {
    open.push(node);
    let child = open.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (open[parent].cost <= open[child].cost) break;
      [open[parent], open[child]] = [open[child], open[parent]];
      child = parent;
    }
  };
  const pop = (): OpenNode | undefined => {
    const first = open[0];
    const last = open.pop();
    if (!first || !last || open.length === 0) return first;
    open[0] = last;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < open.length && open[left].cost < open[smallest].cost) smallest = left;
      if (right < open.length && open[right].cost < open[smallest].cost) smallest = right;
      if (smallest === parent) break;
      [open[parent], open[smallest]] = [open[smallest], open[parent]];
      parent = smallest;
    }
    return first;
  };

  push({ id: startId, cost: heuristic(startId) });
  let visits = 0;
  let closestId = startId;
  let closestDistance = positionAt(startId).distanceToSquared(goalPosition);
  const buildPath = (destination: number): THREE.Vector3[] => {
    const path: THREE.Vector3[] = [positionAt(destination)];
    let cursor = destination;
    while (cameFrom.has(cursor)) {
      cursor = cameFrom.get(cursor) as number;
      if (cursor !== startId) path.push(positionAt(cursor));
    }
    path.reverse();
    return path;
  };

  while (open.length && visits++ < 5000) {
    const current = pop();
    if (!current || closed.has(current.id)) continue;
    const distanceToGoal = positionAt(current.id).distanceToSquared(goalPosition);
    if (distanceToGoal < closestDistance) {
      closestId = current.id;
      closestDistance = distanceToGoal;
    }
    if (goalId !== null && current.id === goalId) return buildPath(goalId);
    closed.add(current.id);
    const cx = Math.floor(current.id / rows);
    const cz = current.id % rows;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= columns || nz < 0 || nz >= rows) continue;
        const nextId = idAt(nx, nz);
        if (closed.has(nextId) || !canOccupy(nextId)) continue;
        if (dx !== 0 && dz !== 0 && (!canOccupy(idAt(cx + dx, cz)) || !canOccupy(idAt(cx, cz + dz)))) continue;
        const nextScore = (scores.get(current.id) as number) + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (nextScore >= (scores.get(nextId) ?? Infinity)) continue;
        cameFrom.set(nextId, current.id);
        scores.set(nextId, nextScore);
        push({ id: nextId, cost: nextScore + heuristic(nextId) });
      }
    }
  }
  // A closed door can split the walkable grid. Follow the best reachable route to its
  // near side, then replan when the door or target changes.
  return closestId === startId ? [] : buildPath(closestId);
}
