; case globals-011-holdsclosure
; expect exit=0 stdout="42\n"
.func main arity=0 locals=0
  CLOSURE twice
  STORE_GLOBAL f
  LOAD_GLOBAL f
  PUSH_INT 21
  CALL 1
  PRINT
  RET
.end
.func twice arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 2
  MUL
  RET
.end
