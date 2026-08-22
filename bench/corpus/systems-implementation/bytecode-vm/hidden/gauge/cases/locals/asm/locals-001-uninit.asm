; case locals-001-uninit
; expect exit=0 stdout="nil\nnil\nnil\n"
.func main arity=0 locals=3
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 1
  PRINT
  LOAD_LOCAL 2
  PRINT
  RET
.end
