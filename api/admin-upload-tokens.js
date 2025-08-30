const { Pool } = require('pg');
const { verifyAdmin } = require('./admin-middleware');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 1,
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls)'));
    }
  }
});

const processExcelFile = (buffer) => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    const tokens = [];
    
    // Process each row - chỉ cần cột A (token)
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (row.length > 0 && row[0]) {
        const token = row[0].toString().trim();
        
        if (token.length > 0) {
          tokens.push({
            token: token,
            requests: 50, // Mặc định 50 requests
            expiresAt: null, // Không hết hạn
            description: `Token từ Excel - 50 requests`
          });
        }
      }
    }
    
    return tokens;
  } catch (error) {
    throw new Error('Lỗi xử lý file Excel: ' + error.message);
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Verify admin access
  await new Promise((resolve, reject) => {
    verifyAdmin(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  }).catch(() => {
    return; // Error already sent by middleware
  });

  let client;
  
  try {
    client = await pool.connect();

    if (req.method === 'GET') {
      // Get uploaded tokens with pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      const status = req.query.status; // 'used', 'available', 'expired'

      let query = `
        SELECT ut.id, ut.token_value, ut.requests, ut.expires_at, ut.is_used, ut.used_at,
               ut.upload_batch_id, ut.description, ut.created_at,
               u.username as used_by_username,
               CASE WHEN ut.expires_at IS NOT NULL AND ut.expires_at < NOW() THEN true ELSE false END as is_expired
        FROM uploaded_tokens ut
        LEFT JOIN users u ON ut.used_by = u.id
      `;
      let countQuery = 'SELECT COUNT(*) as total FROM uploaded_tokens ut';
      let conditions = [];
      let params = [];

      if (status === 'used') {
        conditions.push('ut.is_used = true');
      } else if (status === 'available') {
        conditions.push('ut.is_used = false');
        conditions.push('(ut.expires_at IS NULL OR ut.expires_at > NOW())');
      } else if (status === 'expired') {
        conditions.push('ut.expires_at IS NOT NULL AND ut.expires_at < NOW()');
      }

      if (conditions.length > 0) {
        const whereClause = ' WHERE ' + conditions.join(' AND ');
        query += whereClause;
        countQuery += whereClause;
      }

      query += ' ORDER BY ut.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const [tokensResult, countResult] = await Promise.all([
        client.query(query, params),
        client.query(countQuery)
      ]);

      const tokens = tokensResult.rows;
      const total = parseInt(countResult.rows[0].total);

      res.status(200).json({
        tokens,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });

    } else if (req.method === 'POST') {
      // Handle file upload
      upload.single('excelFile')(req, res, async (err) => {
        if (err) {
          return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'Vui lòng chọn file Excel' });
        }

        try {
          const tokens = processExcelFile(req.file.buffer);
          
          if (tokens.length === 0) {
            return res.status(400).json({ error: 'File Excel không chứa token hợp lệ' });
          }

          const batchId = uuidv4();
          const insertedTokens = [];
          const errors = [];

          // Insert tokens to database
          for (const tokenData of tokens) {
            try {
              const result = await client.query(`
                INSERT INTO uploaded_tokens (token_value, requests, expires_at, description, upload_batch_id, created_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                RETURNING id, token_value, requests, expires_at, description
              `, [tokenData.token, tokenData.requests, tokenData.expiresAt, tokenData.description, batchId]);
              
              insertedTokens.push(result.rows[0]);
            } catch (insertError) {
              if (insertError.code === '23505') { // Unique violation
                errors.push(`Token "${tokenData.token}" đã tồn tại`);
              } else {
                errors.push(`Lỗi khi chèn token "${tokenData.token}": ${insertError.message}`);
              }
            }
          }

          // Log admin activity
          await client.query(
            'INSERT INTO admin_activities (admin_id, activity_type, description, new_value, created_at) VALUES ($1, $2, $3, $4, NOW())',
            [
              req.user.id, 
              'upload_tokens', 
              `Admin ${req.user.username} uploaded ${insertedTokens.length} tokens`,
              JSON.stringify({ batchId, tokenCount: insertedTokens.length, errorCount: errors.length })
            ]
          );

          res.status(201).json({
            message: `Upload thành công ${insertedTokens.length} tokens`,
            batchId,
            insertedCount: insertedTokens.length,
            totalProcessed: tokens.length,
            errors: errors.length > 0 ? errors : undefined,
            sample: insertedTokens.slice(0, 5) // Show first 5 tokens as sample
          });

        } catch (processError) {
          res.status(400).json({ error: processError.message });
        }
      });

    } else {
      res.status(405).json({ error: 'Method không được hỗ trợ' });
    }

  } catch (error) {
    console.error('Admin upload tokens error:', error);
    res.status(500).json({ 
      error: 'Lỗi server',
      details: error.message 
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};