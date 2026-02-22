export interface User {
  id: number;
  username: string;
  password: string;
  nombre: string;
  apellido: string;
  tipoTrabajo?: string;
  dni: string;
  telefono?: string;
  email?: string;
  fechaCreacion: Date;
  fechaCese?: Date;
  estado: string;
  role: Role;
  foto?: string;
  sede?: Sede;
  sede_id?: number;
  coordinador?: User;
  coordinador_id?: number;
  numeroServidor?: string;
  googleAccountEmail?: string;
  numeroAgente?: string;
}

export interface Sede {
  id: number;
  nombre: string;
  direccion?: string;
  telefono?: string;
  estado?: string;
}

export enum Role {
  ASESOR = 'ASESOR',
  ADMIN = 'ADMIN',
  BACKOFFICE = 'BACKOFFICE',
  BACKOFFICETRAMITADOR = 'BACKOFFICETRAMITADOR',
  BACKOFFICESEGUIMIENTO = 'BACKOFFICESEGUIMIENTO',
  COORDINADOR = 'COORDINADOR',
  AUDITOR = 'AUDITOR',
  PROGRAMADOR = 'PROGRAMADOR',
  GERENCIA = 'GERENCIA',
  PSICOLOGO = 'PSICOLOGO',
  BACKOFFICE1 = 'BACKOFFICE1',
  COACHING = 'COACHING',
  LECTOR = 'LECTOR',
  JEFEPISO = 'JEFEPISO',
  MARKETING = 'MARKETING',
  RECURSOSHUMANOS = 'RECURSOSHUMANOS',
  RRHHJEFE = 'RRHHJEFE',
  SEGURIDAD = 'SEGURIDAD',
}
