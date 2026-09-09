import { IsString } from 'class-validator';

export class ImportBackupDto {
  @IsString()
  confirm!: string;
}
