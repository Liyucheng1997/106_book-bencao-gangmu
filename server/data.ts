export type Herb = {
  id: string
  name: string
  pinyin: string
  latin: string
  category: string
  subcategory: string
  part: string
  nature: string
  flavor: string
  origin: string
  summary: string
  classic: string
  tags: string[]
  image: string
  imageSource: string
  imageLicense: string
}

export const categories = [
  { id: 'water', name: '水部', mark: '水', count: 46, tone: '#91aeb0', note: '天水、地水' },
  { id: 'fire', name: '火部', mark: '火', count: 12, tone: '#b85b47', note: '凡火、阳火阴火' },
  { id: 'earth', name: '土部', mark: '土', count: 64, tone: '#a7835a', note: '土类、诸土' },
  { id: 'metal-stone', name: '金石部', mark: '石', count: 163, tone: '#7e8d86', note: '金、玉、石、卤石' },
  { id: 'herb', name: '草部', mark: '草', count: 450, tone: '#456b52', note: '山草、芳草、湿草等' },
  { id: 'grain', name: '谷部', mark: '谷', count: 79, tone: '#b2924c', note: '麻麦稻、稷粟、菽豆' },
  { id: 'vegetable', name: '菜部', mark: '菜', count: 106, tone: '#668654', note: '荤辛、柔滑、蓏菜' },
  { id: 'fruit', name: '果部', mark: '果', count: 107, tone: '#9c584a', note: '五果、山果、夷果' },
  { id: 'wood', name: '木部', mark: '木', count: 160, tone: '#735f42', note: '香木、乔木、灌木' },
  { id: 'utensil', name: '服器部', mark: '器', count: 79, tone: '#8a7362', note: '服帛、器物' },
  { id: 'insect', name: '虫部', mark: '虫', count: 105, tone: '#82704b', note: '卵生、化生、湿生' },
  { id: 'scale', name: '鳞部', mark: '鳞', count: 94, tone: '#4f7880', note: '龙、蛇、鱼' },
  { id: 'shell', name: '介部', mark: '介', count: 46, tone: '#8c8170', note: '龟鳖、蚌蛤' },
  { id: 'bird', name: '禽部', mark: '禽', count: 76, tone: '#667477', note: '水禽、原禽、林禽' },
  { id: 'beast', name: '兽部', mark: '兽', count: 88, tone: '#765f54', note: '畜、兽、鼠、寓怪' },
  { id: 'human', name: '人部', mark: '人', count: 37, tone: '#9a6453', note: '人之一部' },
]

export const herbs: Herb[] = [
  {
    id: 'renshen', name: '人参', pinyin: 'RÉN SHĒN', latin: 'Panax ginseng', category: 'herb', subcategory: '山草类', part: '根',
    nature: '微温', flavor: '甘、微苦', origin: '上党山谷及辽东', summary: '五加科植物人参的干燥根。古籍以根形近人而得名，是山草类的代表本草。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['山草', '根类', '五加科'], image: '/herbs/renshen.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Insam_(ginseng).jpg', imageLicense: 'CC BY-SA 2.0 KR',
  },
  {
    id: 'huangqi', name: '黄芪', pinyin: 'HUÁNG QÍ', latin: 'Astragalus membranaceus', category: 'herb', subcategory: '山草类', part: '根',
    nature: '微温', flavor: '甘', origin: '蜀郡、汉中、白水', summary: '豆科黄芪属多年生草本，以干燥根入药。古称黄耆，位列草部山草。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['山草', '豆科', '根类'], image: '/herbs/huangqi.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Astragalus_membranaceus.jpg', imageLicense: 'CC BY 2.5',
  },
  {
    id: 'danggui', name: '当归', pinyin: 'DĀNG GUĪ', latin: 'Angelica sinensis', category: 'herb', subcategory: '芳草类', part: '根',
    nature: '温', flavor: '甘、辛', origin: '陇西川谷', summary: '伞形科当归的干燥根。植株与根部形态均具鲜明的本草辨识特征。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['芳草', '伞形科', '根类'], image: '/herbs/danggui.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Dongquai_cr.jpg', imageLicense: 'Public domain',
  },
  {
    id: 'gancao', name: '甘草', pinyin: 'GĀN CǍO', latin: 'Glycyrrhiza uralensis', category: 'herb', subcategory: '山草类', part: '根及根茎',
    nature: '平', flavor: '甘', origin: '河西川谷积沙山及上郡', summary: '豆科甘草属植物，根及根茎常见于传统方药，也被古人称作“国老”。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['山草', '豆科', '根茎'], image: '/herbs/gancao.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Glycyrrhizauralensis.jpg', imageLicense: 'Public domain',
  },
  {
    id: 'dahuang', name: '大黄', pinyin: 'DÀ HUÁNG', latin: 'Rheum palmatum', category: 'herb', subcategory: '毒草类', part: '根及根茎',
    nature: '寒', flavor: '苦', origin: '河西山谷及陇西', summary: '蓼科大黄属高大草本，掌状叶片与粗壮根茎是其主要视觉特征。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['毒草', '蓼科', '根茎'], image: '/herbs/dahuang.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Rheum_palmatum_MHNT.BOT.2011.3.67.jpg', imageLicense: 'CC BY-SA 3.0',
  },
  {
    id: 'jinyinhua', name: '金银花', pinyin: 'JĪN YÍN HUĀ', latin: 'Lonicera japonica', category: 'herb', subcategory: '蔓草类', part: '花蕾',
    nature: '寒', flavor: '甘', origin: '各地山野篱落', summary: '忍冬科忍冬的花蕾。花初开白色，后转黄色，故有金银花之称。',
    classic: '释名、集解、气味、主治、发明、附方', tags: ['蔓草', '忍冬科', '花类'], image: '/herbs/jinyinhua.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/Category:Lonicera_japonica', imageLicense: 'CC BY-SA 4.0',
  },
  {
    id: 'aiye', name: '艾叶', pinyin: 'ÀI YÈ', latin: 'Artemisia argyi', category: 'herb', subcategory: '隰草类', part: '叶',
    nature: '温', flavor: '苦、辛', origin: '田野间广布', summary: '菊科蒿属多年生草本，叶背密被灰白色绒毛，是传统辨识的显著特征。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['隰草', '菊科', '叶类'], image: '/herbs/aiye.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Artemis_argyi_plant.jpg', imageLicense: 'CC BY-SA 4.0',
  },
  {
    id: 'shengjiang', name: '生姜', pinyin: 'SHĒNG JIĀNG', latin: 'Zingiber officinale', category: 'vegetable', subcategory: '荤辛类', part: '根茎',
    nature: '微温', flavor: '辛', origin: '各地栽培', summary: '姜科姜的鲜根茎，既入日常饮食，也在《本草纲目》菜部中留下完整条目。',
    classic: '释名、集解、气味、主治、发明、附方', tags: ['荤辛', '姜科', '根茎'], image: '/herbs/shengjiang.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Ginger_Plant_vs.jpg', imageLicense: 'CC BY-SA 3.0',
  },
  {
    id: 'gouqi', name: '枸杞', pinyin: 'GǑU QǏ', latin: 'Lycium barbarum', category: 'wood', subcategory: '灌木类', part: '果实',
    nature: '平', flavor: '甘', origin: '常山平泽及诸丘陵阪岸', summary: '茄科枸杞属灌木，红色浆果醒目。古籍还分别记述枸杞叶、根与果实。',
    classic: '释名、集解、气味、主治、发明、附方', tags: ['灌木', '茄科', '果实'], image: '/herbs/gouqi.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Lycium-barbarum-fruits.JPG', imageLicense: 'CC BY-SA 3.0',
  },
  {
    id: 'rougui', name: '肉桂', pinyin: 'RÒU GUÌ', latin: 'Cinnamomum cassia', category: 'wood', subcategory: '香木类', part: '树皮',
    nature: '大热', flavor: '辛、甘', origin: '岭南桂州、交趾', summary: '樟科肉桂的干燥树皮。常绿乔木，叶有离基三出脉，树皮具芳香。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['香木', '樟科', '树皮'], image: '/herbs/rougui.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Cinnamomum_aromaticum_-_K%C3%B6hler%E2%80%93s_Medizinal-Pflanzen-039_cropped.jpg', imageLicense: 'Public domain',
  },
  {
    id: 'fuling', name: '茯苓', pinyin: 'FÚ LÍNG', latin: 'Wolfiporia cocos', category: 'wood', subcategory: '寓木类', part: '菌核',
    nature: '平', flavor: '甘、淡', origin: '泰山山谷大松下', summary: '多孔菌科真菌的干燥菌核，常寄生于松根，与古人“松之神灵之气”的理解相映照。',
    classic: '释名、集解、修治、气味、主治、发明、附方', tags: ['寓木', '真菌', '菌核'], image: '/herbs/fuling.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/File:Tuckahoe.jpg', imageLicense: 'Public domain',
  },
  {
    id: 'lianzi', name: '莲子', pinyin: 'LIÁN ZǏ', latin: 'Nelumbo nucifera', category: 'fruit', subcategory: '水果类', part: '种子',
    nature: '平', flavor: '甘、涩', origin: '池泽栽种', summary: '莲科莲的成熟种子。花、叶、房、须、子与藕等不同部位在本草体系中各有记录。',
    classic: '释名、集解、气味、主治、发明、附方', tags: ['水果', '莲科', '种子'], image: '/herbs/lianzi.jpg',
    imageSource: 'https://commons.wikimedia.org/wiki/Category:Nelumbo_nucifera', imageLicense: 'CC BY-SA 4.0',
  },
]
