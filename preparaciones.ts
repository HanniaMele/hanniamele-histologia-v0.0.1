/**
 * Datos "de verdad" sobre la preparación que se ve en el microscopio.
 *
 * ¿Por qué esto vive en su propio archivo y no directo en el prompt del
 * agente? Porque así el modelo de lenguaje no está "adivinando" datos
 * histológicos (algo que los modelos hacen fácilmente si no les das una
 * fuente) — la tool `explicar_imagen_microscopio` (en agentTools.ts) LEE
 * este objeto y se lo pasa como hecho. Si el dato está mal, el agente
 * repetirá el error con toda confianza, así que hay que llenarlo con
 * cuidado.
 *
 * ⚠️ Hannia: al revisar la imagen (albcre_he.webp) la morfología (células
 * poligonales en cordones que irradian, con espacios claros entre ellas)
 * se parece a tejido HEPÁTICO (hígado), pero no lo pude confirmar porque no
 * tenemos la fuente original de la base de datos de donde la sacaste.
 * Antes de usar esto en la tesis: confirma el tejido real y ajusta este
 * objeto — el resto del código no depende de que el dato sea "hígado",
 * solo lee lo que sea que pongas aquí.
 */

export interface EstructuraVisible {
  /** Clave corta y sin espacios: la usa la tool `senalar_en_imagen` (ver
   *  agentTools.ts) para saber qué recuadro dibujar sobre la imagen. */
  clave: string
  /** Texto legible — lo que el agente lee y le puede repetir al estudiante. */
  descripcion: string
  /**
   * Posición aproximada dentro de la imagen, en % desde la esquina superior
   * izquierda (0-100 en x y en y). Puestas A OJO viendo albcre_he.webp — el
   * tejido es denso y repetitivo, así que son una referencia, no una
   * anotación real. Ajusta si el recuadro no cae donde debería: abre la
   * imagen, calcula a ojo qué % del ancho/alto le corresponde al punto que
   * quieres señalar, y cambia el número.
   */
  x: number
  y: number
}

export const PREPARACION_ACTUAL = {
  archivo: 'albcre_he.webp',
  tincion: 'Hematoxilina y Eosina (H&E)',
  tejido: 'Hígado (identificación visual preliminar, SIN CONFIRMAR contra la fuente original)',
  estructurasVisibles: [
    {
      clave: 'cordones_hepatocitos',
      descripcion:
        'Cordones de hepatocitos: células poligonales con núcleo redondo, dispuestas en filas que irradian.',
      x: 50,
      y: 50,
    },
    {
      clave: 'espacios_sinusoidales',
      descripcion: 'Espacios sinusoidales: los huecos claros entre los cordones de células.',
      x: 8,
      y: 45,
    },
    {
      clave: 'nucleos_basofilos',
      descripcion:
        'Núcleos basófilos (morados/azules) dispersos, posiblemente células de Kupffer o epitelio de conductos biliares.',
      x: 62,
      y: 35,
    },
  ] as EstructuraVisible[],
  notas: 'Identificación visual preliminar, no confirmada contra la fuente original de la imagen.',
}
