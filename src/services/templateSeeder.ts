import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const COMMON_TEMPLATES = [
  {
    name: 'PCR (Polymerase Chain Reaction)',
    type: 'Molecular Biology',
    color: '#ef4444', // Red
    description: 'Standard protocol for DNA amplification using thermal cycling.',
    steps: [
      { day_offset: 0, description: 'Prepare master mix and samples', duration_minutes: 60, notes: 'Keep reagents on ice.' },
      { day_offset: 0, description: 'Run thermal cycler', duration_minutes: 120, notes: 'Check program settings.' },
      { day_offset: 0, description: 'Gel electrophoresis', duration_minutes: 90, notes: 'Use 1.5% agarose gel.' },
      { day_offset: 0, description: 'Imaging and analysis', duration_minutes: 30, notes: 'Save image to lab records.' }
    ]
  },
  {
    name: 'Western Blot',
    type: 'Protein Analysis',
    color: '#3b82f6', // Blue
    description: 'Detection of specific proteins in a sample using antibodies.',
    steps: [
      { day_offset: 0, description: 'Protein extraction and quantification', duration_minutes: 180, notes: 'Use BCA assay for quantification.' },
      { day_offset: 0, description: 'SDS-PAGE', duration_minutes: 90, notes: '120V constant voltage.' },
      { day_offset: 0, description: 'Transfer to membrane', duration_minutes: 60, notes: 'Wet transfer at 100V for 1h.' },
      { day_offset: 0, description: 'Blocking', duration_minutes: 60, notes: '5% non-fat milk in TBST.' },
      { day_offset: 0, description: 'Primary antibody incubation', duration_minutes: null, notes: 'Overnight at 4°C with gentle shaking.' },
      { day_offset: 1, description: 'Washing and secondary antibody incubation', duration_minutes: 120, notes: '3x 10min washes; 1h secondary incubation.' },
      { day_offset: 1, description: 'Detection and imaging', duration_minutes: 60, notes: 'Use ECL substrate.' }
    ]
  },
  {
    name: 'Cell Culture Passaging',
    type: 'Cell Biology',
    color: '#10b981', // Emerald
    description: 'Routine maintenance and subculturing of adherent cell lines.',
    steps: [
      { day_offset: 0, description: 'Check cell confluence', duration_minutes: 10, notes: 'Aim for 70-80% confluence.' },
      { day_offset: 0, description: 'Trypsinization and cell counting', duration_minutes: 30, notes: 'Use 0.25% Trypsin-EDTA.' },
      { day_offset: 0, description: 'Seeding into new flasks', duration_minutes: 20, notes: 'Label flasks with date and passage number.' }
    ]
  },
  {
    name: 'ELISA Assay',
    type: 'Immunology',
    color: '#f59e0b', // Amber
    description: 'Enzyme-linked immunosorbent assay for quantifying antigens or antibodies.',
    steps: [
      { day_offset: 0, description: 'Plate coating', duration_minutes: null, notes: 'Overnight at 4°C.' },
      { day_offset: 1, description: 'Blocking', duration_minutes: 60, notes: '1% BSA in PBS.' },
      { day_offset: 1, description: 'Sample and standard addition', duration_minutes: 120, notes: 'Incubate at RT.' },
      { day_offset: 1, description: 'Detection antibody addition', duration_minutes: 60, notes: 'Dilute according to manufacturer.' },
      { day_offset: 1, description: 'Substrate addition and stop', duration_minutes: 30, notes: 'Watch for color development.' },
      { day_offset: 1, description: 'Plate reading and analysis', duration_minutes: 30, notes: 'Measure OD at 450nm.' }
    ]
  },
  {
    name: 'DNA Extraction (Spin Column)',
    type: 'Molecular Biology',
    color: '#8b5cf6', // Violet
    description: 'Purification of genomic or plasmid DNA from biological samples.',
    steps: [
      { day_offset: 0, description: 'Sample lysis', duration_minutes: 60, notes: 'Add Proteinase K.' },
      { day_offset: 0, description: 'Binding to column', duration_minutes: 15, notes: 'Centrifuge at 8000g.' },
      { day_offset: 0, description: 'Washing steps', duration_minutes: 30, notes: 'Use AW1 and AW2 buffers.' },
      { day_offset: 0, description: 'Elution', duration_minutes: 10, notes: 'Use AE buffer or water.' },
      { day_offset: 0, description: 'Quantification (NanoDrop)', duration_minutes: 15, notes: 'Record A260/280 ratio.' }
    ]
  },
  {
    name: 'RNA Extraction (Trizol Method)',
    type: 'Molecular Biology',
    color: '#ec4899', // Pink
    description: 'Isolation of high-quality total RNA from cells or tissues.',
    steps: [
      { day_offset: 0, description: 'Homogenization in Trizol', duration_minutes: 30, notes: 'Work in fume hood.' },
      { day_offset: 0, description: 'Phase separation (Chloroform)', duration_minutes: 30, notes: 'Centrifuge at 12000g, 4°C.' },
      { day_offset: 0, description: 'RNA precipitation (Isopropanol)', duration_minutes: 60, notes: 'Incubate at -20°C for 30min.' },
      { day_offset: 0, description: 'RNA washing (75% Ethanol)', duration_minutes: 30, notes: 'Centrifuge at 7500g, 4°C.' },
      { day_offset: 0, description: 'Resuspension and quantification', duration_minutes: 20, notes: 'Use RNase-free water.' }
    ]
  },
  {
    name: 'Flow Cytometry (Surface Staining)',
    type: 'Immunology',
    color: '#06b6d4', // Cyan
    description: 'Staining of cell surface markers for flow cytometric analysis.',
    steps: [
      { day_offset: 0, description: 'Cell preparation and counting', duration_minutes: 30, notes: 'Adjust to 10^6 cells/mL.' },
      { day_offset: 0, description: 'Fc blocking', duration_minutes: 15, notes: 'Incubate on ice.' },
      { day_offset: 0, description: 'Primary antibody staining', duration_minutes: 30, notes: 'Incubate in dark at 4°C.' },
      { day_offset: 0, description: 'Washing steps', duration_minutes: 20, notes: '3x washes with FACS buffer.' },
      { day_offset: 0, description: 'Data acquisition', duration_minutes: 60, notes: 'Run samples on flow cytometer.' }
    ]
  },
  {
    name: 'Immunofluorescence (IF)',
    type: 'Cell Biology',
    color: '#84cc16', // Lime
    description: 'Visualizing specific proteins in fixed cells using fluorescent antibodies.',
    steps: [
      { day_offset: 0, description: 'Cell fixation (4% PFA)', duration_minutes: 15, notes: 'Incubate at RT.' },
      { day_offset: 0, description: 'Permeabilization (0.1% Triton X-100)', duration_minutes: 10, notes: 'Skip for surface markers.' },
      { day_offset: 0, description: 'Blocking (BSA/Serum)', duration_minutes: 60, notes: 'Incubate at RT.' },
      { day_offset: 0, description: 'Primary antibody incubation', duration_minutes: null, notes: 'Overnight at 4°C.' },
      { day_offset: 1, description: 'Secondary antibody and DAPI staining', duration_minutes: 90, notes: 'Incubate in dark at RT.' },
      { day_offset: 1, description: 'Mounting and imaging', duration_minutes: 60, notes: 'Use anti-fade mounting medium.' }
    ]
  },
  {
    name: 'Plasmid Transformation (Heat Shock)',
    type: 'Microbiology',
    color: '#f97316', // Orange
    description: 'Introducing plasmid DNA into competent E. coli cells.',
    steps: [
      { day_offset: 0, description: 'Thaw competent cells on ice', duration_minutes: 15, notes: 'Handle gently.' },
      { day_offset: 0, description: 'Add DNA and incubate', duration_minutes: 30, notes: 'Incubate on ice.' },
      { day_offset: 0, description: 'Heat shock (42°C)', duration_minutes: 1, notes: 'Exactly 45-60 seconds.' },
      { day_offset: 0, description: 'Recovery in SOC/LB medium', duration_minutes: 60, notes: 'Incubate at 37°C with shaking.' },
      { day_offset: 0, description: 'Plating on selective agar', duration_minutes: 15, notes: 'Incubate overnight at 37°C.' }
    ]
  }
];

export const seedCommonTemplates = async () => {
  const templatesCol = collection(db, 'templates');
  
  for (const t of COMMON_TEMPLATES) {
    // Check if template already exists to avoid duplicates
    const q = query(templatesCol, where('name', '==', t.name));
    const existing = await getDocs(q);
    
    if (existing.empty) {
      const { steps, ...templateData } = t;
      const docRef = await addDoc(templatesCol, {
        ...templateData,
        project_id: null
      });
      
      const stepsCol = collection(db, 'template_steps');
      for (let i = 0; i < steps.length; i++) {
        await addDoc(stepsCol, {
          template_id: docRef.id,
          ...steps[i],
          step_order: i
        });
      }
    }
  }
};
