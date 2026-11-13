import { req } from '../shared/api.js';

export const login = (username, password, portal) => req('/api/auth/login', { method: 'POST', body: { username, password, portal } });
export const me = () => req('/api/auth/me', { auth: true });
export const changePassword = (current, next) => req('/api/auth/password', { method: 'POST', auth: true, body: { current, next } });

export const selectRoad = (lat, lng, radius) => req(`/api/roads/select?lat=${lat}&lng=${lng}&radius_m=${radius}`, { auth: true });
export const createIncident = (body) => req('/api/incidents', { method: 'POST', auth: true, body });
export const listIncidents = (status) => req(`/api/incidents?status=${status}`, { auth: true });
export const cancelIncident = (id) => req(`/api/incidents/${id}`, { method: 'DELETE', auth: true });
export const tripStats = () => req('/api/trips/stats');

export const listUsers = () => req('/api/admin/users', { auth: true });
export const createUser = (body) => req('/api/admin/users', { method: 'POST', auth: true, body });
export const updateUser = (id, body) => req(`/api/admin/users/${id}`, { method: 'PATCH', auth: true, body });
export const listDevices = () => req('/api/admin/devices', { auth: true });
export const createDevice = (body) => req('/api/admin/devices', { method: 'POST', auth: true, body });
export const updateDevice = (id, body) => req(`/api/admin/devices/${id}`, { method: 'PATCH', auth: true, body });
export const listAudit = () => req('/api/admin/audit', { auth: true });
export const startImport = (body) => req('/api/admin/import-osm', { method: 'POST', auth: true, body });
export const importStatus = () => req('/api/admin/import-status', { auth: true });
