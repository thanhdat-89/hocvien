import { useState, useEffect, useMemo } from 'react';
import { X, Save, Percent, DollarSign, UserX, Search } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

const AddPromotionModal = ({ classes, students = [], onAdd, onBulkAdd, onUpdate, onClose, initialData }) => {
    const { showToast } = useNotification();
    const [selectedClassIds, setSelectedClassIds] = useState([]);
    const [excludedStudentIds, setExcludedStudentIds] = useState([]);
    const [excludeSearch, setExcludeSearch] = useState('');
    const [formData, setFormData] = useState({
        month: new Date().toISOString().substring(0, 7), // YYYY-MM
        discountType: 'percent', // 'percent' | 'amount'
        discountRate: 0,
        discountAmount: 0,
        description: ''
    });

    useEffect(() => {
        if (initialData) {
            setSelectedClassIds([initialData.classId]);
            setExcludedStudentIds(initialData.excludedStudentIds || []);
            setFormData({
                month: initialData.month || '',
                discountType: initialData.discountType || 'percent',
                discountRate: (initialData.discountRate || 0) * 100,
                discountAmount: initialData.discountAmount || 0,
                description: initialData.description || ''
            });
        }
    }, [initialData]);

    const toggleClass = (classId) => {
        if (initialData) {
            setSelectedClassIds([classId]);
            return;
        }
        setSelectedClassIds(prev =>
            prev.includes(classId)
                ? prev.filter(id => id !== classId)
                : [...prev, classId]
        );
    };

    const toggleExcludeStudent = (studentId) => {
        setExcludedStudentIds(prev =>
            prev.includes(studentId)
                ? prev.filter(id => id !== studentId)
                : [...prev, studentId]
        );
    };

    // Students that belong to the selected class(es) — only shown when 1 class selected
    const eligibleStudents = useMemo(() => {
        if (selectedClassIds.length !== 1) return [];
        return students
            .filter(s => s.classId === selectedClassIds[0] && s.status !== 'Đã nghỉ' && s.status !== 'Đã xóa')
            .filter(s => s.name.toLowerCase().includes(excludeSearch.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }, [selectedClassIds, students, excludeSearch]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (selectedClassIds.length === 0) {
            showToast('Vui lòng chọn ít nhất một lớp học.', 'warning');
            return;
        }

        if (formData.discountType === 'percent' && (formData.discountRate <= 0 || formData.discountRate > 100)) {
            showToast('Phần trăm giảm giá phải từ 1 đến 100.', 'warning');
            return;
        }

        if (formData.discountType === 'amount' && formData.discountAmount <= 0) {
            showToast('Số tiền giảm giá phải lớn hơn 0.', 'warning');
            return;
        }

        const baseData = {
            month: formData.month,
            discountType: formData.discountType,
            discountRate: formData.discountType === 'percent' ? formData.discountRate / 100 : 0,
            discountAmount: formData.discountType === 'amount' ? parseFloat(formData.discountAmount) : 0,
            excludedStudentIds: selectedClassIds.length === 1 ? excludedStudentIds : [],
            description: formData.description
        };

        try {
            if (initialData) {
                await onUpdate(initialData.id, { ...baseData, classId: selectedClassIds[0] });
            } else if (selectedClassIds.length === 1) {
                await onAdd({ ...baseData, classId: selectedClassIds[0] });
            } else {
                const records = selectedClassIds.map(classId => ({
                    ...baseData,
                    classId
                }));
                await onBulkAdd(records);
            }
            onClose();
        } catch (error) {
            // Error handling is managed by the action
        }
    };

    const tabStyle = (active) => ({
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.4rem',
        padding: '0.55rem 1rem',
        borderRadius: '10px',
        fontSize: '0.85rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        border: 'none',
        background: active ? 'var(--primary)' : 'transparent',
        color: active ? 'white' : 'var(--text-secondary)',
        boxShadow: active ? '0 4px 12px rgba(99, 102, 241, 0.35)' : 'none',
    });

    const showExcludeSection = selectedClassIds.length === 1;

    return (
        <div className="modal-overlay">
            <div className="modal-content card" style={{ maxWidth: '500px', width: '90%', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
                <button onClick={onClose} className="btn-close-modal">
                    <X size={24} />
                </button>

                <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
                    {initialData ? 'Chỉnh sửa Khuyến mãi' : 'Thêm Khuyến mãi Mới'}
                </h2>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Classes */}
                    <div>
                        <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>Lớp học áp dụng</label>
                        <div style={{
                            maxHeight: '180px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.6rem',
                            padding: '0.25rem'
                        }}>
                            {classes.map(c => {
                                const isSelected = selectedClassIds.includes(c.id);
                                return (
                                    <div
                                        key={c.id}
                                        onClick={() => toggleClass(c.id)}
                                        style={{
                                            padding: '0.4rem 0.8rem',
                                            borderRadius: '20px',
                                            fontSize: '0.8rem',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            background: isSelected ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
                                            color: isSelected ? 'white' : 'var(--text-primary)',
                                            border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--glass-border)'}`,
                                            boxShadow: isSelected ? '0 4px 12px rgba(99, 102, 241, 0.3)' : 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            userSelect: 'none'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isSelected) e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                        }}
                                    >
                                        {c.name}
                                    </div>
                                );
                            })}
                        </div>
                        {!initialData && (
                            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                                <button type="button" className="btn btn-glass btn-sm" onClick={() => setSelectedClassIds(classes.map(c => c.id))} style={{ fontSize: '0.75rem' }}>Chọn tất cả</button>
                                <button type="button" className="btn btn-glass btn-sm" onClick={() => setSelectedClassIds([])} style={{ fontSize: '0.75rem' }}>Bỏ chọn</button>
                            </div>
                        )}
                    </div>

                    {/* Month */}
                    <div>
                        <label className="form-label">Tháng áp dụng</label>
                        <input
                            type="month"
                            className="glass"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            value={formData.month}
                            onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                            required
                        />
                    </div>

                    {/* Discount type toggle */}
                    <div>
                        <label className="form-label" style={{ marginBottom: '0.6rem', display: 'block' }}>Loại giảm giá</label>
                        <div style={{
                            display: 'flex',
                            gap: '0.25rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1.5px solid var(--glass-border)',
                            borderRadius: '12px',
                            padding: '0.25rem',
                        }}>
                            <button type="button" style={tabStyle(formData.discountType === 'percent')} onClick={() => setFormData({ ...formData, discountType: 'percent' })}>
                                <Percent size={15} /> Phần trăm (%)
                            </button>
                            <button type="button" style={tabStyle(formData.discountType === 'amount')} onClick={() => setFormData({ ...formData, discountType: 'amount' })}>
                                <DollarSign size={15} /> Số tiền (đ)
                            </button>
                        </div>
                    </div>

                    {/* Discount value */}
                    {formData.discountType === 'percent' ? (
                        <div>
                            <label className="form-label">Phần trăm giảm giá (%)</label>
                            <input
                                type="number"
                                className="glass"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                min="1" max="100"
                                value={formData.discountRate}
                                onChange={(e) => setFormData({ ...formData, discountRate: parseFloat(e.target.value) || 0 })}
                                placeholder="Ví dụ: 10 (nghĩa là giảm 10%)"
                                required
                            />
                        </div>
                    ) : (
                        <div>
                            <label className="form-label">Số tiền giảm (đ)</label>
                            <input
                                type="number"
                                className="glass"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                min="1000" step="1000"
                                value={formData.discountAmount}
                                onChange={(e) => setFormData({ ...formData, discountAmount: parseFloat(e.target.value) || 0 })}
                                placeholder="Ví dụ: 50000 (nghĩa là giảm 50.000đ)"
                                required
                            />
                            {formData.discountAmount > 0 && (
                                <p style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--success)' }}>
                                    → Giảm: {parseFloat(formData.discountAmount).toLocaleString('vi-VN')} đ / tháng
                                </p>
                            )}
                        </div>
                    )}

                    {/* Exclude students — only when 1 class is selected */}
                    {showExcludeSection && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                <UserX size={16} color="var(--warning)" />
                                <label className="form-label" style={{ margin: 0 }}>Học sinh không áp dụng khuyến mãi</label>
                                {excludedStudentIds.length > 0 && (
                                    <span style={{
                                        background: 'var(--warning)',
                                        color: '#000',
                                        borderRadius: '20px',
                                        padding: '0.1rem 0.5rem',
                                        fontSize: '0.72rem',
                                        fontWeight: 700
                                    }}>
                                        {excludedStudentIds.length} học sinh
                                    </span>
                                )}
                            </div>

                            {/* Search */}
                            <div style={{ position: 'relative', marginBottom: '0.6rem' }}>
                                <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                                <input
                                    type="text"
                                    className="glass"
                                    style={{ width: '100%', boxSizing: 'border-box', paddingLeft: '2.2rem', fontSize: '0.85rem' }}
                                    placeholder="Tìm tên học sinh..."
                                    value={excludeSearch}
                                    onChange={(e) => setExcludeSearch(e.target.value)}
                                />
                            </div>

                            {eligibleStudents.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textAlign: 'center', padding: '0.75rem' }}>
                                    {students.filter(s => s.classId === selectedClassIds[0]).length === 0
                                        ? 'Lớp này chưa có học sinh nào.'
                                        : 'Không tìm thấy học sinh phù hợp.'}
                                </p>
                            ) : (
                                <div style={{
                                    maxHeight: '180px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.4rem',
                                    border: '1.5px solid var(--glass-border)',
                                    borderRadius: '12px',
                                    padding: '0.5rem',
                                    background: 'rgba(255,255,255,0.03)'
                                }}>
                                    {eligibleStudents.map(s => {
                                        const isExcluded = excludedStudentIds.includes(s.id);
                                        return (
                                            <div
                                                key={s.id}
                                                onClick={() => toggleExcludeStudent(s.id)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.6rem',
                                                    padding: '0.45rem 0.75rem',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.15s ease',
                                                    background: isExcluded ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                                                    border: `1.5px solid ${isExcluded ? 'rgba(245, 158, 11, 0.4)' : 'transparent'}`,
                                                    userSelect: 'none'
                                                }}
                                                onMouseEnter={e => { if (!isExcluded) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                                onMouseLeave={e => { if (!isExcluded) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                {/* Checkbox visual */}
                                                <div style={{
                                                    width: '18px', height: '18px',
                                                    borderRadius: '5px',
                                                    border: `2px solid ${isExcluded ? 'var(--warning)' : 'var(--glass-border)'}`,
                                                    background: isExcluded ? 'var(--warning)' : 'transparent',
                                                    flexShrink: 0,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    transition: 'all 0.15s ease'
                                                }}>
                                                    {isExcluded && (
                                                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                            <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                                        </svg>
                                                    )}
                                                </div>
                                                <span style={{
                                                    fontSize: '0.85rem',
                                                    fontWeight: isExcluded ? 600 : 400,
                                                    color: isExcluded ? 'var(--warning)' : 'var(--text-primary)',
                                                    flex: 1
                                                }}>
                                                    {s.name}
                                                </span>
                                                {isExcluded && (
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600 }}>Loại trừ</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {excludedStudentIds.length > 0 && (
                                <button
                                    type="button"
                                    className="btn btn-glass btn-sm"
                                    style={{ marginTop: '0.4rem', fontSize: '0.75rem' }}
                                    onClick={() => setExcludedStudentIds([])}
                                >
                                    Bỏ chọn tất cả
                                </button>
                            )}
                        </div>
                    )}

                    {/* Description */}
                    <div>
                        <label className="form-label">Mô tả chương trình (tùy chọn)</label>
                        <textarea
                            className="glass"
                            style={{ width: '100%', resize: 'none', boxSizing: 'border-box' }}
                            rows="2"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Ví dụ: Giảm giá nhân dịp khai trường..."
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                        <button type="button" onClick={onClose} className="btn btn-glass" style={{ flex: 1 }}>
                            Hủy
                        </button>
                        <button type="submit" className="btn btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <Save size={18} /> {initialData ? 'Cập nhật' : 'Lưu khuyến mãi'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddPromotionModal;
