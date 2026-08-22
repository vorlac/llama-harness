; case strops-107-bytes
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_INT 200
  CHR
  PUSH_INT 201
  CHR
  CONCAT
  LEN
  PRINT
  RET
.end
