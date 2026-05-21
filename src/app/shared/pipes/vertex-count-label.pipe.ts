import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'vertexCountLabel',
})
export class VertexCountLabelPipe implements PipeTransform {
  transform(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return `${count} вершина`;
    }

    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return `${count} вершини`;
    }

    return `${count} вершин`;
  }
}
