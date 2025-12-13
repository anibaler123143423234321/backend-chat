import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecentSearch, SearchType } from './entities/recent-search.entity';
import { CreateRecentSearchDto } from './dto/create-recent-search.dto';

@Injectable()
export class RecentSearchesService {
  private readonly logger = new Logger(RecentSearchesService.name);

  constructor(
    @InjectRepository(RecentSearch)
    private readonly recentSearchRepository: Repository<RecentSearch>,
  ) {}

  /**
   * Guardar una nueva búsqueda reciente
   * Si ya existe el mismo término para el usuario, actualiza el timestamp
   */
  async create(createRecentSearchDto: CreateRecentSearchDto): Promise<RecentSearch> {
    try {
      // Buscar si ya existe esta búsqueda para este usuario
      const existingSearch = await this.recentSearchRepository.findOne({
        where: {
          username: createRecentSearchDto.username,
          searchTerm: createRecentSearchDto.searchTerm,
        },
      });

      if (existingSearch) {
        // Actualizar el timestamp y otros datos
        existingSearch.searchType = createRecentSearchDto.searchType || existingSearch.searchType;
        existingSearch.resultCount = createRecentSearchDto.resultCount ?? existingSearch.resultCount;
        existingSearch.clickedResultId = createRecentSearchDto.clickedResultId || existingSearch.clickedResultId;
        existingSearch.updatedAt = new Date();
        
        return await this.recentSearchRepository.save(existingSearch);
      }

      // Crear nueva búsqueda
      const newSearch = this.recentSearchRepository.create(createRecentSearchDto);
      return await this.recentSearchRepository.save(newSearch);
    } catch (error) {
      this.logger.error(`Error al guardar búsqueda reciente: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtener búsquedas recientes de un usuario
   * Limitado a las últimas 20 búsquedas
   */
  async findByUsername(username: string, limit: number = 20): Promise<RecentSearch[]> {
    try {
      return await this.recentSearchRepository.find({
        where: { username },
        order: { updatedAt: 'DESC' },
        take: limit,
      });
    } catch (error) {
      this.logger.error(`Error al obtener búsquedas recientes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtener búsquedas recientes por tipo
   */
  async findByUsernameAndType(
    username: string,
    searchType: SearchType,
    limit: number = 10,
  ): Promise<RecentSearch[]> {
    try {
      return await this.recentSearchRepository.find({
        where: { username, searchType },
        order: { updatedAt: 'DESC' },
        take: limit,
      });
    } catch (error) {
      this.logger.error(`Error al obtener búsquedas por tipo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Eliminar una búsqueda específica
   */
  async remove(id: number, username: string): Promise<void> {
    try {
      await this.recentSearchRepository.delete({ id, username });
    } catch (error) {
      this.logger.error(`Error al eliminar búsqueda: ${error.message}`);
      throw error;
    }
  }

  /**
   * Limpiar todas las búsquedas de un usuario
   */
  async clearAll(username: string): Promise<void> {
    try {
      await this.recentSearchRepository.delete({ username });
      this.logger.log(`Búsquedas eliminadas para usuario: ${username}`);
    } catch (error) {
      this.logger.error(`Error al limpiar búsquedas: ${error.message}`);
      throw error;
    }
  }

  /**
   * Limpiar búsquedas antiguas (más de 30 días)
   * Útil para ejecutar como tarea programada
   */
  async cleanOldSearches(daysOld: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.recentSearchRepository
        .createQueryBuilder()
        .delete()
        .where('updatedAt < :cutoffDate', { cutoffDate })
        .execute();

      this.logger.log(`Búsquedas antiguas eliminadas: ${result.affected}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error(`Error al limpiar búsquedas antiguas: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtener estadísticas de búsquedas
   */
  async getSearchStats(username: string): Promise<any> {
    try {
      const stats = await this.recentSearchRepository
        .createQueryBuilder('search')
        .select('search.searchType', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('search.username = :username', { username })
        .groupBy('search.searchType')
        .getRawMany();

      return stats;
    } catch (error) {
      this.logger.error(`Error al obtener estadísticas: ${error.message}`);
      throw error;
    }
  }
}

