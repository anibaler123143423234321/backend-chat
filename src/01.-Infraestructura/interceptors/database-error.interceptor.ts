import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { QueryFailedError } from 'typeorm';

@Injectable()
export class DatabaseErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        // Manejar errores de conexión a la base de datos
        if (error instanceof QueryFailedError) {
          const driverError = error.driverError;

          // Errores de conexión (ECONNRESET, ECONNREFUSED, etc.)
          if (
            driverError &&
            (driverError.code === 'ECONNRESET' ||
              driverError.code === 'ECONNREFUSED' ||
              driverError.code === 'ETIMEDOUT' ||
              driverError.errno === -4077)
          ) {
            console.error('🔌 Error de conexión a la base de datos:', {
              code: driverError.code,
              errno: driverError.errno,
              message: driverError.message,
            });

            // Retornar error 503 (Service Unavailable) para errores de BD
            return throwError(
              () =>
                new HttpException(
                  {
                    statusCode: 503,
                    message: 'Servicio temporalmente no disponible',
                    error: 'Database Connection Error',
                    details:
                      'La conexión a la base de datos no está disponible temporalmente',
                  },
                  HttpStatus.SERVICE_UNAVAILABLE,
                ),
            );
          }

          // Otros errores de base de datos
          console.error('🗄️ Error de base de datos:', error.message);
          return throwError(
            () =>
              new HttpException(
                {
                  statusCode: 500,
                  message: 'Error interno del servidor',
                  error: 'Database Error',
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
              ),
          );
        }

        // Re-lanzar otros errores sin modificar
        return throwError(() => error);
      }),
    );
  }
}
