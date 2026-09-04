class ResourceLockManager {
    constructor() {
        this.locks = new Map(); // resourceKey -> { ownerExecutionId, acquiredAt, expiresAt, heartbeat }
        this.waitGraphs = new Map(); // executionId -> Set<executionId> (para detección de deadlocks)
        this.defaultLeaseMs = 30000; // 30s lease
    }

    acquireLock(resourceKey, ownerExecutionId, leaseMs = this.defaultLeaseMs) {
        this.cleanupExpired();
        const existing = this.locks.get(resourceKey);

        if (existing) {
            if (existing.ownerExecutionId === ownerExecutionId) {
                // Renovar lease propio
                existing.expiresAt = Date.now() + leaseMs;
                existing.heartbeat = Date.now();
                return { acquired: true, renewed: true };
            }

            // Registrar dependencia en grafo para deadlocks
            if (!this.waitGraphs.has(ownerExecutionId)) {
                this.waitGraphs.set(ownerExecutionId, new Set());
            }
            this.waitGraphs.get(ownerExecutionId).add(existing.ownerExecutionId);

            if (this.detectDeadlock(ownerExecutionId, new Set())) {
                console.warn(`[ResourceLock] 🚨 Deadlock detectado para recurso ${resourceKey} por ejecución ${ownerExecutionId}.`);
                return { acquired: false, code: 'ERR_DEADLOCK_DETECTED', reason: `Interbloqueo detectado al solicitar recurso ${resourceKey}.` };
            }

            return {
                acquired: false,
                code: 'ERR_RESOURCE_LOCKED',
                reason: `El recurso ${resourceKey} está bloqueado por la ejecución ${existing.ownerExecutionId}.`,
                holder: existing.ownerExecutionId,
                expiresInMs: Math.max(0, existing.expiresAt - Date.now())
            };
        }

        // Adquirir lock
        const now = Date.now();
        this.locks.set(resourceKey, {
            ownerExecutionId,
            acquiredAt: now,
            expiresAt: now + leaseMs,
            heartbeat: now
        });

        return { acquired: true, renewed: false };
    }

    heartbeat(resourceKey, ownerExecutionId, leaseMs = this.defaultLeaseMs) {
        const lock = this.locks.get(resourceKey);
        if (lock && lock.ownerExecutionId === ownerExecutionId) {
            lock.heartbeat = Date.now();
            lock.expiresAt = Date.now() + leaseMs;
            return true;
        }
        return false;
    }

    releaseLock(resourceKey, ownerExecutionId) {
        const lock = this.locks.get(resourceKey);
        if (lock && lock.ownerExecutionId === ownerExecutionId) {
            this.locks.delete(resourceKey);
            this.waitGraphs.delete(ownerExecutionId);
            return true;
        }
        return false;
    }

    releaseAllForOwner(ownerExecutionId) {
        for (const [key, lock] of this.locks.entries()) {
            if (lock.ownerExecutionId === ownerExecutionId) {
                this.locks.delete(key);
            }
        }
        this.waitGraphs.delete(ownerExecutionId);
    }

    cleanupExpired() {
        const now = Date.now();
        for (const [key, lock] of this.locks.entries()) {
            if (now > lock.expiresAt) {
                console.log(`[ResourceLock] ⏳ Lease expirado para recurso ${key} de ejecución ${lock.ownerExecutionId}. Liberando.`);
                this.locks.delete(key);
                this.waitGraphs.delete(lock.ownerExecutionId);
            }
        }
    }

    detectDeadlock(currentId, visited) {
        if (visited.has(currentId)) return true;
        visited.add(currentId);

        const waitingOn = this.waitGraphs.get(currentId);
        if (waitingOn) {
            for (const neighbor of waitingOn) {
                if (this.detectDeadlock(neighbor, new Set(visited))) {
                    return true;
                }
            }
        }
        return false;
    }
}

const resourceLockManager = new ResourceLockManager();
module.exports = resourceLockManager;
