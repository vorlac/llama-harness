; case closures-013-noupvals
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  CLOSURE plain
  CALL 0
  PRINT
  RET
.end
.func plain arity=0 locals=0
  PUSH_INT 1
  RET
.end
