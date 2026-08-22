; case errors-019-errorinframe
; expect exit=4 stdout="a\nb\n"
; expect error=E_DIV_ZERO
.func main arity=0 locals=0
  PUSH_STR "a"
  PRINT
  CLOSURE boom
  CALL 0
  PRINT
  RET
.end
.func boom arity=0 locals=0
  PUSH_STR "b"
  PRINT
  PUSH_INT 1
  PUSH_INT 0
  DIV
  RET
.end
