import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecentSearchesController } from './recent-searches.controller';
import { RecentSearchesService } from './recent-searches.service';
import { RecentSearch } from './entities/recent-search.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecentSearch]),
  ],
  controllers: [RecentSearchesController],
  providers: [RecentSearchesService],
  exports: [RecentSearchesService],
})
export class RecentSearchesModule {}

