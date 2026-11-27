export type User = {
  maNhanVien: string,
  tenNhanVien: string,
  maPhongBan: string,
  idObject: string,
  userId: string,
  avatar?: string,
  type?: 'group' | 'individual'
};